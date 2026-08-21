use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_JSON_BYTES: u32 = 64 * 1024;
pub const MAX_PAYLOAD_BYTES: u32 = 12 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestHeader {
    pub protocol: u32,
    pub command: String,
    pub request_id: Option<String>,
    pub session_id: Option<String>,
    #[serde(default)]
    pub target_request_id: Option<String>,
    #[serde(default)]
    pub model_dir: Option<String>,
    #[serde(default)]
    pub quantization: Option<String>,
    #[serde(default)]
    pub requested_provider: Option<String>,
    #[serde(default)]
    pub from_sample: Option<u64>,
    #[serde(default)]
    pub through_sample: Option<u64>,
    #[serde(default)]
    pub sequence: Option<u64>,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug)]
pub struct Frame {
    pub header: RequestHeader,
    pub payload: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FrameReadError {
    Io(String),
    Oversized { json_bytes: u32, payload_bytes: u32 },
    InvalidJson(String),
}

impl From<io::Error> for FrameReadError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

pub fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Frame>, FrameReadError> {
    let mut prefix = [0_u8; 8];
    match reader.read(&mut prefix[..1]) {
        Ok(0) => return Ok(None),
        Ok(1) => {}
        Ok(_) => unreachable!("the first frame read is one byte"),
        Err(error) => return Err(FrameReadError::Io(error.to_string())),
    }
    if let Err(error) = reader.read_exact(&mut prefix[1..]) {
        if error.kind() == io::ErrorKind::UnexpectedEof {
            return Err(FrameReadError::Io("truncated frame prefix".to_string()));
        }
        return Err(FrameReadError::Io(error.to_string()));
    }

    let json_bytes = u32::from_le_bytes(prefix[0..4].try_into().expect("four bytes"));
    let payload_bytes = u32::from_le_bytes(prefix[4..8].try_into().expect("four bytes"));
    if json_bytes > MAX_JSON_BYTES || payload_bytes > MAX_PAYLOAD_BYTES {
        return Err(FrameReadError::Oversized {
            json_bytes,
            payload_bytes,
        });
    }

    let mut json = vec![0_u8; json_bytes as usize];
    reader.read_exact(&mut json)?;
    let mut payload = vec![0_u8; payload_bytes as usize];
    reader.read_exact(&mut payload)?;
    let header = serde_json::from_slice(&json)
        .map_err(|error| FrameReadError::InvalidJson(error.to_string()))?;
    Ok(Some(Frame { header, payload }))
}

pub fn write_frame<W: Write, T: Serialize>(
    writer: &mut W,
    header: &T,
    payload: &[u8],
) -> io::Result<()> {
    let json = serde_json::to_vec(header)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    if json.len() > MAX_JSON_BYTES as usize || payload.len() > MAX_PAYLOAD_BYTES as usize {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "frame exceeds protocol limits",
        ));
    }
    writer.write_all(&(json.len() as u32).to_le_bytes())?;
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(&json)?;
    writer.write_all(payload)?;
    writer.flush()
}

pub fn valid_request_id(request_id: &Option<String>) -> bool {
    request_id
        .as_deref()
        .is_some_and(|value| !value.is_empty() && value.len() <= 256)
}

pub fn valid_session_id(session_id: &Option<String>) -> bool {
    session_id
        .as_deref()
        .is_some_and(|value| !value.is_empty() && value.len() <= 256)
}

#[derive(Debug, Default)]
pub struct RequestTracker {
    seen_request_ids: std::collections::HashSet<String>,
    session_id: Option<String>,
    active_request_id: Option<String>,
    cancelled_request_ids: std::collections::HashSet<String>,
}

impl RequestTracker {
    pub fn accept_request(&mut self, request_id: &str) -> Result<(), &'static str> {
        if !self.seen_request_ids.insert(request_id.to_string()) {
            return Err("duplicate_request_id");
        }
        Ok(())
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    pub fn load_session(&mut self, session_id: &str) -> Result<(), &'static str> {
        if self.session_id.is_some() {
            return Err("session_already_loaded");
        }
        self.session_id = Some(session_id.to_string());
        Ok(())
    }

    pub fn unload_session(&mut self) {
        self.session_id = None;
        self.active_request_id = None;
        self.cancelled_request_ids.clear();
    }

    pub fn require_session(&self, session_id: &str) -> Result<(), &'static str> {
        if self.session_id.as_deref() != Some(session_id) {
            return Err("unknown_session");
        }
        Ok(())
    }

    pub fn begin_inference(&mut self, request_id: &str) -> Result<(), &'static str> {
        if self.active_request_id.is_some() {
            return Err("inference_busy");
        }
        self.active_request_id = Some(request_id.to_string());
        Ok(())
    }

    pub fn cancel_inference(&mut self, request_id: &str) -> Result<(), &'static str> {
        if self.active_request_id.as_deref() != Some(request_id) {
            return Err("unknown_operation");
        }
        self.cancelled_request_ids.insert(request_id.to_string());
        Ok(())
    }

    pub fn finish_inference(&mut self, request_id: &str) -> bool {
        if self.active_request_id.as_deref() != Some(request_id) {
            return false;
        }
        self.active_request_id = None;
        self.cancelled_request_ids.remove(request_id)
    }

    #[cfg(test)]
    pub fn is_cancelled(&self, request_id: &str) -> bool {
        self.cancelled_request_ids.contains(request_id)
    }

    pub fn has_active_inference(&self) -> bool {
        self.active_request_id.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(command: &str, request_id: &str, session_id: Option<&str>) -> RequestHeader {
        RequestHeader {
            protocol: PROTOCOL_VERSION,
            command: command.to_string(),
            request_id: Some(request_id.to_string()),
            session_id: session_id.map(str::to_string),
            target_request_id: None,
            model_dir: None,
            quantization: None,
            requested_provider: None,
            from_sample: None,
            through_sample: None,
            sequence: None,
            operation_id: None,
        }
    }

    #[test]
    fn frame_round_trip_preserves_header_and_payload() {
        let header = request("transcribe_range", "req-1", Some("session-1"));
        let payload = vec![0_u8, 1, 255, 127];
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &header, &payload).expect("write frame");
        let frame = read_frame(&mut bytes.as_slice())
            .expect("read frame")
            .expect("frame");
        assert_eq!(frame.header.command, "transcribe_range");
        assert_eq!(frame.header.request_id.as_deref(), Some("req-1"));
        assert_eq!(frame.payload, payload);
    }

    #[test]
    fn oversized_declaration_is_rejected_before_payload_allocation() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(MAX_JSON_BYTES + 1).to_le_bytes());
        bytes.extend_from_slice(&0_u32.to_le_bytes());
        let error = read_frame(&mut bytes.as_slice()).expect_err("oversized frame");
        assert_eq!(
            error,
            FrameReadError::Oversized {
                json_bytes: MAX_JSON_BYTES + 1,
                payload_bytes: 0
            }
        );
    }

    #[test]
    fn truncated_prefix_is_not_treated_as_clean_eof() {
        let error = read_frame(&mut [1_u8, 0].as_slice()).expect_err("truncated prefix");
        assert_eq!(
            error,
            FrameReadError::Io("truncated frame prefix".to_string())
        );
    }

    #[test]
    fn tracker_rejects_duplicate_ids_unknown_sessions_and_late_cancel() {
        let mut tracker = RequestTracker::default();
        tracker.accept_request("req-1").expect("first request");
        assert_eq!(tracker.accept_request("req-1"), Err("duplicate_request_id"));
        assert_eq!(tracker.require_session("session-1"), Err("unknown_session"));
        tracker.load_session("session-1").expect("load");
        tracker.begin_inference("req-2").expect("begin");
        tracker.cancel_inference("req-2").expect("cancel");
        assert!(tracker.is_cancelled("req-2"));
        assert!(tracker.finish_inference("req-2"));
        assert!(!tracker.is_cancelled("req-2"));
        assert_eq!(tracker.cancel_inference("req-2"), Err("unknown_operation"));
    }
}
