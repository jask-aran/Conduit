mod protocol;

use std::io::{self, BufReader, BufWriter};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use env_logger::Target;
use serde::Serialize;
use serde_json::{json, Value};
use transcribe_rs::accel::{set_ort_accelerator, OrtAccelerator};
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
use transcribe_rs::onnx::Quantization;

use crate::protocol::{
    read_frame, valid_request_id, valid_session_id, write_frame, Frame, FrameReadError,
    RequestHeader, RequestTracker, MAX_JSON_BYTES, MAX_PAYLOAD_BYTES, PROTOCOL_VERSION,
};

const WORKER_VERSION: &str = env!("CARGO_PKG_VERSION");
const ORT_VERSION: &str = "1.24.2";
const SAMPLE_RATE: u32 = 16_000;
const MAX_PCM_SAMPLES: u64 = 16_000 * 60 * 5;

#[derive(Debug)]
enum ReaderEvent {
    Request(Frame),
    Inference(InferenceEvent),
    ProtocolError(String),
    Eof,
}

#[derive(Debug)]
enum InferenceCommand {
    Load {
        model_dir: PathBuf,
        quantization: Quantization,
        requested_provider: String,
    },
    Transcribe {
        request_id: String,
        from_sample: u64,
        through_sample: u64,
        sequence: u64,
        operation_id: Option<String>,
        pcm: Vec<u8>,
    },
    Unload,
    Shutdown,
}

#[derive(Debug)]
enum InferenceEvent {
    Loaded { requested_provider: String },
    LoadFailed(String),
    Transcribed(TranscriptionOutput),
    TranscriptionFailed { request_id: String, message: String },
    Unloaded,
    Shutdown,
}

#[derive(Debug)]
struct TranscriptionOutput {
    request_id: String,
    from_sample: u64,
    through_sample: u64,
    sequence: u64,
    operation_id: Option<String>,
    text: String,
    timestamps: Vec<TimestampOutput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimestampOutput {
    text: String,
    from_sample: u64,
    through_sample: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseHeader {
    protocol: u32,
    response: bool,
    command: String,
    request_id: Option<String>,
    session_id: Option<String>,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: String,
    message: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .target(Target::Stderr)
        .init();

    let (event_tx, event_rx) = mpsc::channel();
    let reader_tx = event_tx.clone();
    thread::spawn(move || read_requests(reader_tx));
    let (inference_tx, inference_rx) = mpsc::channel();
    let inference_events = event_tx.clone();
    let inference_thread = thread::spawn(move || inference_loop(inference_rx, inference_events));

    let stdout = io::stdout();
    let mut writer = BufWriter::new(stdout.lock());
    let mut tracker = RequestTracker::default();
    let mut pending_load: Option<(String, String, String)> = None;
    let mut pending_unload: Option<(String, Option<String>)> = None;
    let mut active_session: Option<String> = None;
    let mut running = true;

    while running {
        let event = match event_rx.recv() {
            Ok(event) => event,
            Err(_) => break,
        };
        match event {
            ReaderEvent::Request(frame) => {
                running = handle_request(
                    frame,
                    &mut writer,
                    &mut tracker,
                    &mut pending_load,
                    &mut pending_unload,
                    &mut active_session,
                    &inference_tx,
                )?;
            }
            ReaderEvent::Inference(event) => {
                handle_inference_event(
                    event,
                    &mut writer,
                    &mut tracker,
                    &mut pending_load,
                    &mut pending_unload,
                    &mut active_session,
                )?;
            }
            ReaderEvent::ProtocolError(message) => {
                write_error(&mut writer, None, None, "protocol_error", &message)?;
                running = false;
            }
            ReaderEvent::Eof => {
                running = false;
            }
        }
    }

    let _ = inference_tx.send(InferenceCommand::Shutdown);
    let _ = inference_thread.join();
    Ok(())
}

fn read_requests(tx: Sender<ReaderEvent>) {
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    loop {
        match read_frame(&mut reader) {
            Ok(Some(frame)) => {
                if tx.send(ReaderEvent::Request(frame)).is_err() {
                    return;
                }
            }
            Ok(None) => {
                let _ = tx.send(ReaderEvent::Eof);
                return;
            }
            Err(error) => {
                let message = match error {
                    FrameReadError::Oversized { json_bytes, payload_bytes } => format!(
                        "frame declaration exceeds limits: jsonBytes={json_bytes}, payloadBytes={payload_bytes}, limits=({MAX_JSON_BYTES},{MAX_PAYLOAD_BYTES})"
                    ),
                    FrameReadError::Io(message) | FrameReadError::InvalidJson(message) => message,
                };
                let _ = tx.send(ReaderEvent::ProtocolError(message));
                return;
            }
        }
    }
}

fn inference_loop(rx: Receiver<InferenceCommand>, events: Sender<ReaderEvent>) {
    let mut model: Option<ParakeetModel> = None;
    while let Ok(command) = rx.recv() {
        match command {
            InferenceCommand::Load {
                model_dir,
                quantization,
                requested_provider,
            } => {
                let loaded = (|| {
                    set_provider(&requested_provider)?;
                    ParakeetModel::load(&model_dir, &quantization)
                        .map_err(|error| error.to_string())
                })();
                match loaded {
                    Ok(loaded_model) => {
                        model = Some(loaded_model);
                        let _ = events.send(ReaderEvent::Inference(InferenceEvent::Loaded {
                            requested_provider,
                        }));
                    }
                    Err(message) => {
                        let _ = events
                            .send(ReaderEvent::Inference(InferenceEvent::LoadFailed(message)));
                    }
                }
            }
            InferenceCommand::Transcribe {
                request_id,
                from_sample,
                through_sample,
                sequence,
                operation_id,
                pcm,
            } => {
                let result = if let Some(model) = model.as_mut() {
                    let samples = pcm16_to_f32(&pcm);
                    model
                        .transcribe_with(
                            &samples,
                            &ParakeetParams {
                                timestamp_granularity: Some(TimestampGranularity::Segment),
                                ..Default::default()
                            },
                        )
                        .map(|value| TranscriptionOutput {
                            request_id: request_id.clone(),
                            from_sample,
                            through_sample,
                            sequence,
                            operation_id,
                            text: value.text.trim().to_string(),
                            timestamps: verified_timestamps(
                                value.segments,
                                from_sample,
                                through_sample,
                            ),
                        })
                        .map_err(|error| error.to_string())
                } else {
                    Err("model_not_loaded".to_string())
                };
                match result {
                    Ok(output) => {
                        let _ = events
                            .send(ReaderEvent::Inference(InferenceEvent::Transcribed(output)));
                    }
                    Err(message) => {
                        let _ = events.send(ReaderEvent::Inference(
                            InferenceEvent::TranscriptionFailed {
                                request_id,
                                message,
                            },
                        ));
                    }
                }
            }
            InferenceCommand::Unload => {
                model = None;
                let _ = events.send(ReaderEvent::Inference(InferenceEvent::Unloaded));
            }
            InferenceCommand::Shutdown => {
                let _ = events.send(ReaderEvent::Inference(InferenceEvent::Shutdown));
                return;
            }
        }
    }
}

fn set_provider(provider: &str) -> Result<(), String> {
    match provider {
        "auto" => set_ort_accelerator(OrtAccelerator::Auto),
        "cpu" => set_ort_accelerator(OrtAccelerator::CpuOnly),
        other => return Err(format!("unsupported ORT provider request: {other}")),
    }
    Ok(())
}

fn pcm16_to_f32(pcm: &[u8]) -> Vec<f32> {
    pcm.chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0)
        .collect()
}

fn verified_timestamps(
    segments: Option<Vec<transcribe_rs::TranscriptionSegment>>,
    from_sample: u64,
    through_sample: u64,
) -> Vec<TimestampOutput> {
    let Some(segments) = segments else {
        return Vec::new();
    };
    let duration = through_sample.saturating_sub(from_sample);
    segments
        .into_iter()
        .filter_map(|segment| {
            if !segment.start.is_finite() || !segment.end.is_finite() || segment.end < segment.start
            {
                return None;
            }
            let start = from_sample
                .saturating_add((segment.start.max(0.0) * SAMPLE_RATE as f32).round() as u64);
            let end = from_sample
                .saturating_add((segment.end.max(0.0) * SAMPLE_RATE as f32).round() as u64);
            let start = start.clamp(from_sample, through_sample);
            let end = end.clamp(start, through_sample);
            let text = segment.text.trim().to_string();
            if text.is_empty() || end <= start || start > from_sample.saturating_add(duration) {
                return None;
            }
            Some(TimestampOutput {
                text,
                from_sample: start,
                through_sample: end,
            })
        })
        .collect()
}

fn handle_request(
    frame: Frame,
    writer: &mut impl io::Write,
    tracker: &mut RequestTracker,
    pending_load: &mut Option<(String, String, String)>,
    pending_unload: &mut Option<(String, Option<String>)>,
    active_session: &mut Option<String>,
    inference_tx: &Sender<InferenceCommand>,
) -> Result<bool, io::Error> {
    let header = frame.header;
    let request_id = header.request_id.clone();
    let session_id = header.session_id.clone();
    if header.protocol != PROTOCOL_VERSION {
        write_error(
            writer,
            request_id,
            session_id,
            "protocol_version",
            "unsupported protocol version",
        )?;
        return Ok(true);
    }
    if !valid_request_id(&request_id) {
        write_error(
            writer,
            request_id,
            session_id,
            "request_id_invalid",
            "requestId is required and must be at most 256 bytes",
        )?;
        return Ok(true);
    }
    let request_id_value = request_id.as_deref().expect("validated request id");
    if let Err(code) = tracker.accept_request(request_id_value) {
        write_error(
            writer,
            request_id,
            session_id,
            code,
            "requestId was already used",
        )?;
        return Ok(true);
    }

    match header.command.as_str() {
        "hello" => {
            write_ok(
                writer,
                &header,
                json!({
                    "workerVersion": WORKER_VERSION,
                    "crateVersion": "0.3.8",
                    "ortVersion": ORT_VERSION,
                    "compiledOrtProviders": ["cpu"],
                    "adapters": ["parakeet"],
                    "ports": { "batch": true, "stream": false },
                    "sampleFormat": { "sampleRate": SAMPLE_RATE, "channels": 1, "encoding": "pcm_s16le" },
                    "requestLimits": { "maxJsonBytes": MAX_JSON_BYTES, "maxPayloadBytes": MAX_PAYLOAD_BYTES, "maxPcmSamples": MAX_PCM_SAMPLES },
                    "target": { "os": std::env::consts::OS, "arch": std::env::consts::ARCH },
                }),
            )?;
        }
        "health" => {
            if let Some(session) = session_id.as_deref() {
                if let Err(code) = tracker.require_session(session) {
                    write_error(writer, request_id, session_id, code, "unknown session")?;
                    return Ok(true);
                }
            }
            write_ok(
                writer,
                &header,
                json!({
                    "ready": true,
                    "loaded": tracker.session_id().is_some(),
                    "sessionId": tracker.session_id(),
                    "active": tracker.has_active_inference(),
                    "compiledOrtProviders": ["cpu"],
                }),
            )?;
        }
        "load" => {
            let Some(session) = session_id.as_deref() else {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "session_id_required",
                    "load requires sessionId",
                )?;
                return Ok(true);
            };
            if !valid_session_id(&header.session_id) {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "session_id_invalid",
                    "sessionId is invalid",
                )?;
                return Ok(true);
            }
            if tracker.session_id().is_some() || pending_load.is_some() {
                write_error(
                    writer,
                    request_id,
                    Some(session.to_string()),
                    "session_already_loaded",
                    "only one loaded session is supported",
                )?;
                return Ok(true);
            }
            let Some(model_dir) = header.model_dir.clone() else {
                write_error(
                    writer,
                    request_id,
                    Some(session.to_string()),
                    "model_dir_required",
                    "load requires modelDir",
                )?;
                return Ok(true);
            };
            let quantization = match header.quantization.as_deref() {
                Some("int8") => Quantization::Int8,
                Some("fp32") | None => Quantization::FP32,
                Some(_value) => {
                    write_error(
                        writer,
                        request_id,
                        Some(session.to_string()),
                        "quantization_invalid",
                        "quantization must be int8 or fp32",
                    )?;
                    return Ok(true);
                }
            };
            let requested_provider = header
                .requested_provider
                .clone()
                .unwrap_or_else(|| "cpu".to_string());
            if requested_provider != "auto" && requested_provider != "cpu" {
                write_error(
                    writer,
                    request_id,
                    Some(session.to_string()),
                    "provider_invalid",
                    "requestedProvider must be auto or cpu",
                )?;
                return Ok(true);
            }
            *pending_load = Some((
                request_id_value.to_string(),
                session.to_string(),
                requested_provider.clone(),
            ));
            inference_tx
                .send(InferenceCommand::Load {
                    model_dir: PathBuf::from(model_dir),
                    quantization,
                    requested_provider,
                })
                .map_err(|_| {
                    io::Error::new(io::ErrorKind::BrokenPipe, "inference worker stopped")
                })?;
        }
        "transcribe_range" => {
            let Some(session) = session_id.as_deref() else {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "session_id_required",
                    "transcribe_range requires sessionId",
                )?;
                return Ok(true);
            };
            if let Err(code) = tracker.require_session(session) {
                write_error(writer, request_id, session_id, code, "unknown session")?;
                return Ok(true);
            }
            let from_sample = header.from_sample.unwrap_or(u64::MAX);
            let through_sample = header.through_sample.unwrap_or(u64::MAX);
            let sample_count = through_sample.saturating_sub(from_sample);
            if through_sample < from_sample
                || sample_count == 0
                || sample_count > MAX_PCM_SAMPLES
                || frame.payload.len() % 2 != 0
                || frame.payload.len() / 2 != sample_count as usize
            {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "range_invalid",
                    "PCM payload and absolute sample range are invalid",
                )?;
                return Ok(true);
            }
            if let Err(code) = tracker.begin_inference(request_id_value) {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    code,
                    "only one inference operation can run at a time",
                )?;
                return Ok(true);
            }
            *active_session = Some(session.to_string());
            inference_tx
                .send(InferenceCommand::Transcribe {
                    request_id: request_id_value.to_string(),
                    from_sample,
                    through_sample,
                    sequence: header.sequence.unwrap_or(0),
                    operation_id: header.operation_id.clone(),
                    pcm: frame.payload,
                })
                .map_err(|_| {
                    io::Error::new(io::ErrorKind::BrokenPipe, "inference worker stopped")
                })?;
        }
        "cancel" => {
            let Some(session) = session_id.as_deref() else {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "session_id_required",
                    "cancel requires sessionId",
                )?;
                return Ok(true);
            };
            if let Err(code) = tracker.require_session(session) {
                write_error(writer, request_id, session_id, code, "unknown session")?;
                return Ok(true);
            }
            let Some(target) = header.target_request_id.as_deref() else {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "target_request_id_required",
                    "cancel requires targetRequestId",
                )?;
                return Ok(true);
            };
            if let Err(code) = tracker.cancel_inference(target) {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    code,
                    "target operation is not active",
                )?;
                return Ok(true);
            }
            write_ok(
                writer,
                &header,
                json!({ "cancelled": true, "targetRequestId": target, "authoritative": false }),
            )?;
        }
        "unload" => {
            let Some(session) = session_id.as_deref() else {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "session_id_required",
                    "unload requires sessionId",
                )?;
                return Ok(true);
            };
            if let Err(code) = tracker.require_session(session) {
                write_error(writer, request_id, session_id, code, "unknown session")?;
                return Ok(true);
            }
            if tracker_active(tracker) || pending_unload.is_some() {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "inference_busy",
                    "cancel the active operation before unload",
                )?;
                return Ok(true);
            }
            *pending_unload = Some((request_id_value.to_string(), session_id.clone()));
            inference_tx.send(InferenceCommand::Unload).map_err(|_| {
                io::Error::new(io::ErrorKind::BrokenPipe, "inference worker stopped")
            })?;
        }
        "shutdown" => {
            if tracker_active(tracker) || pending_load.is_some() || pending_unload.is_some() {
                write_error(
                    writer,
                    request_id,
                    session_id,
                    "worker_busy",
                    "worker has an active operation",
                )?;
                return Ok(true);
            }
            write_ok(writer, &header, json!({ "shuttingDown": true }))?;
            inference_tx.send(InferenceCommand::Shutdown).map_err(|_| {
                io::Error::new(io::ErrorKind::BrokenPipe, "inference worker stopped")
            })?;
            return Ok(false);
        }
        _ => write_error(
            writer,
            request_id,
            session_id,
            "command_unknown",
            "unknown worker command",
        )?,
    }
    Ok(true)
}

fn tracker_active(tracker: &RequestTracker) -> bool {
    tracker.has_active_inference()
}

fn handle_inference_event(
    event: InferenceEvent,
    writer: &mut impl io::Write,
    tracker: &mut RequestTracker,
    pending_load: &mut Option<(String, String, String)>,
    pending_unload: &mut Option<(String, Option<String>)>,
    active_session: &mut Option<String>,
) -> io::Result<()> {
    match event {
        InferenceEvent::Loaded { requested_provider } => {
            let Some((request_id, session_id, pending_provider)) = pending_load.take() else {
                return Ok(());
            };
            if pending_provider != requested_provider {
                write_error(
                    writer,
                    Some(request_id),
                    Some(session_id),
                    "load_state_invalid",
                    "load provider state did not match the request",
                )?;
                return Ok(());
            }
            tracker
                .load_session(&session_id)
                .map_err(|code| io::Error::new(io::ErrorKind::InvalidData, code))?;
            let request = RequestHeader {
                protocol: PROTOCOL_VERSION,
                command: "load".to_string(),
                request_id: Some(request_id),
                session_id: Some(session_id),
                target_request_id: None,
                model_dir: None,
                quantization: None,
                requested_provider: Some(requested_provider.clone()),
                from_sample: None,
                through_sample: None,
                sequence: None,
                operation_id: None,
            };
            write_ok(
                writer,
                &request,
                json!({
                    "requestedProvider": requested_provider,
                    "actualProvider": "cpu",
                    "compiledOrtProviders": ["cpu"],
                    "ports": { "batch": true, "stream": false },
                    "sampleFormat": { "sampleRate": SAMPLE_RATE, "channels": 1, "encoding": "pcm_s16le" },
                }),
            )?;
        }
        InferenceEvent::LoadFailed(message) => {
            if let Some((request_id, session_id, _)) = pending_load.take() {
                write_error(
                    writer,
                    Some(request_id),
                    Some(session_id),
                    "load_failed",
                    &message,
                )?;
            }
        }
        InferenceEvent::Transcribed(output) => {
            let cancelled = tracker.finish_inference(&output.request_id);
            let session_id = active_session.take();
            if cancelled {
                write_error(
                    writer,
                    Some(output.request_id),
                    session_id,
                    "cancelled",
                    "inference completed after cancellation; output is not authoritative",
                )?;
                return Ok(());
            }
            let request = RequestHeader {
                protocol: PROTOCOL_VERSION,
                command: "transcribe_range".to_string(),
                request_id: Some(output.request_id),
                session_id,
                target_request_id: None,
                model_dir: None,
                quantization: None,
                requested_provider: None,
                from_sample: Some(output.from_sample),
                through_sample: Some(output.through_sample),
                sequence: Some(output.sequence),
                operation_id: output.operation_id.clone(),
            };
            write_ok(
                writer,
                &request,
                json!({
                    "text": output.text,
                    "fromSample": output.from_sample,
                    "throughSample": output.through_sample,
                    "sequence": output.sequence,
                    "operationId": output.operation_id,
                    "processedThroughSample": output.through_sample,
                    "timestamps": output.timestamps,
                    "timestampsVerified": true,
                    "authoritative": true,
                }),
            )?;
        }
        InferenceEvent::TranscriptionFailed {
            request_id,
            message,
        } => {
            let cancelled = tracker.finish_inference(&request_id);
            let session_id = active_session.take();
            write_error(
                writer,
                Some(request_id),
                session_id,
                if cancelled {
                    "cancelled"
                } else {
                    "transcription_failed"
                },
                &message,
            )?;
        }
        InferenceEvent::Unloaded => {
            let Some((request_id, session_id)) = pending_unload.take() else {
                return Ok(());
            };
            tracker.unload_session();
            let request = RequestHeader {
                protocol: PROTOCOL_VERSION,
                command: "unload".to_string(),
                request_id: Some(request_id),
                session_id,
                target_request_id: None,
                model_dir: None,
                quantization: None,
                requested_provider: None,
                from_sample: None,
                through_sample: None,
                sequence: None,
                operation_id: None,
            };
            write_ok(writer, &request, json!({ "unloaded": true }))?;
        }
        InferenceEvent::Shutdown => {}
    }
    Ok(())
}

fn write_ok(writer: &mut impl io::Write, request: &RequestHeader, result: Value) -> io::Result<()> {
    let header = ResponseHeader {
        protocol: PROTOCOL_VERSION,
        response: true,
        command: request.command.clone(),
        request_id: request.request_id.clone(),
        session_id: request.session_id.clone(),
        ok: true,
        result: Some(result),
        error: None,
    };
    write_frame(writer, &header, &[])
}

fn write_error(
    writer: &mut impl io::Write,
    request_id: Option<String>,
    session_id: Option<String>,
    code: &str,
    message: &str,
) -> io::Result<()> {
    let header = ResponseHeader {
        protocol: PROTOCOL_VERSION,
        response: true,
        command: "error".to_string(),
        request_id,
        session_id,
        ok: false,
        result: None,
        error: Some(ErrorBody {
            code: code.to_string(),
            message: message.to_string(),
        }),
    };
    write_frame(writer, &header, &[])
}
