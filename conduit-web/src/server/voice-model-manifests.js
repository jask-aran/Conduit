const HUGGING_FACE = "https://huggingface.co";
const PARAKEET_REPOSITORY = "istupakov/parakeet-tdt-0.6b-v3-onnx";
const PARAKEET_VERSION = "v0.8.0";
const PARAKEET_REVISION = "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce";
export const ONNXRUNTIME_VERSION = "1.25.1";

const WHISPER_FILES = Object.freeze([
  "added_tokens.json", "config.json", "generation_config.json", "merges.txt", "normalizer.json", "preprocessor_config.json",
  "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json",
  "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
]);

const WHISPER_MANIFESTS = Object.freeze({
  "whisper-tiny-en-q8": Object.freeze({
    repository: "onnx-community/whisper-tiny.en",
    revision: "2575352d61be1bf7225cf8f8b268a4678025fc58",
    files: Object.freeze({
      "added_tokens.json": [34604, "560be47bea388757f8d4cc185c5d82067426cbb6361e38016dd90ddc01ab203a"],
      "config.json": [2197, "251ea843b5901a99efa58c0b99b8052c6019aa3e7d2baf46693a1128ff606233"],
      "generation_config.json": [1646, "7b2e8451ed5f118e75fdd991409d72119d21d2fef1eba9723f68fb9c57fe5dc9"],
      "merges.txt": [456318, "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5"],
      "normalizer.json": [52666, "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd"],
      "preprocessor_config.json": [339, "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"],
      "special_tokens_map.json": [2173, "98bdf3ec5b32e31575b02f64b0a32bde7c0449075d34484a7df9bdd3cdeb9fb9"],
      "tokenizer.json": [2405679, "5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0"],
      "tokenizer_config.json": [282662, "93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c"],
      "vocab.json": [999186, "f6bd25a65e4e63ca31360e9fb11c7e4f9a391a78385d640acd814092dd6eee4f"],
      "onnx/encoder_model_quantized.onnx": [10124993, "e93ec822f16a8fd264e7de972ad17d615ea7334b75a52d54c50c2e18dd503a25"],
      "onnx/decoder_model_merged_quantized.onnx": [30718858, "c0592d0749413c960569e1c7fb806b060d5d18f3ebad4a95cbf9a77dc6e9be52"],
    }),
  }),
  "whisper-base-q8": Object.freeze({
    repository: "onnx-community/whisper-base",
    revision: "1846881b6b3a3024392c1eea3ad983695bc23925",
    files: Object.freeze({
      "added_tokens.json": [34604, "9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1"],
      "config.json": [2243, "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b"],
      "generation_config.json": [3832, "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0"],
      "merges.txt": [493869, "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6"],
      "normalizer.json": [52666, "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd"],
      "preprocessor_config.json": [339, "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"],
      "special_tokens_map.json": [2194, "e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691"],
      "tokenizer.json": [2480466, "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"],
      "tokenizer_config.json": [282682, "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573"],
      "vocab.json": [1036584, "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a"],
      "onnx/encoder_model_quantized.onnx": [23201314, "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46"],
      "onnx/decoder_model_merged_quantized.onnx": [53693315, "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b"],
    }),
  }),
  "whisper-small-q8": Object.freeze({
    repository: "onnx-community/whisper-small",
    revision: "36050c46d777d46dc4b5f43f6d90574fc38f8732",
    files: Object.freeze({
      "added_tokens.json": [34604, "9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1"],
      "config.json": [2227, "457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18"],
      "generation_config.json": [3893, "f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0"],
      "merges.txt": [493869, "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6"],
      "normalizer.json": [52666, "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd"],
      "preprocessor_config.json": [339, "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"],
      "special_tokens_map.json": [2194, "e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691"],
      "tokenizer.json": [2480466, "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"],
      "tokenizer_config.json": [282683, "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce"],
      "vocab.json": [1036584, "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a"],
      "onnx/encoder_model_quantized.onnx": [92326160, "a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92"],
      "onnx/decoder_model_merged_quantized.onnx": [156750845, "ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9"],
    }),
  }),
});

const PARAKEET_FILES = Object.freeze({
  "config.json": [97, "666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466"],
  "vocab.txt": [93939, "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"],
  "nemo128.onnx": [139764, "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f"],
  "encoder-model.int8.onnx": [652183999, "6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09"],
  "decoder_joint-model.int8.onnx": [18202004, "eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70"],
});

const PARAKEET_RUNTIME = Object.freeze({
  x64: Object.freeze({
    name: "onnxruntime-linux-x64-1.25.1.tgz",
    size: 8518976,
    sha256: "eb566a49cfc49ef0642f809b69340b5bb656c7c4905ba873526d226f2c005816",
  }),
  aarch64: Object.freeze({
    name: "onnxruntime-linux-aarch64-1.25.1.tgz",
    size: 7533892,
    sha256: "daa71b56b00c4ab34798a3d96ca41a32ece4d3e302dc2386d3cca83fd4491214",
  }),
});

const PARAKEET_BINARY = Object.freeze({
  amd64: Object.freeze({ size: 6809344, sha256: "4eaa7123e49756dea7714db20b4ea36aa96f3ba50d7e1ccec7df2ccededcdf9b" }),
  arm64: Object.freeze({ size: 6338344, sha256: "70413b539fae9c7951ead0c069a155f84dc485276281aebbcbc38812ea921882" }),
});

const SILERO = Object.freeze({
  name: "silero_vad.onnx",
  url: "https://raw.githubusercontent.com/snakers4/silero-vad/7e30209a3e901f9842f81b225f3e93d8199902b1/src/silero_vad/data/silero_vad.onnx",
  size: 2327524,
  sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
});

function manifestError(message) {
  return Object.assign(new Error(message), { code: "voice_model_manifest_invalid", status: 502 });
}

function whisperManifest(model) {
  const definition = WHISPER_MANIFESTS[model.id];
  if (!definition || definition.repository !== model.repository || definition.revision !== model.revision) {
    throw manifestError(`No reviewed artifact manifest exists for ${model.label}`);
  }
  return {
    version: "transformers.js-3.8.1",
    modelRevision: definition.revision,
    artifacts: WHISPER_FILES.map((name) => {
      const [size, sha256] = definition.files[name];
      return {
        name,
        relative: name,
        url: `${HUGGING_FACE}/${definition.repository}/resolve/${definition.revision}/${name}`,
        size,
        sha256,
      };
    }),
  };
}

function parakeetManifest(architecture) {
  const binary = PARAKEET_BINARY[architecture.release];
  const runtime = PARAKEET_RUNTIME[architecture.runtime];
  if (!binary || !runtime) throw manifestError(`No reviewed Parakeet package exists for ${architecture.release}`);
  return {
    version: PARAKEET_VERSION,
    modelRevision: PARAKEET_REVISION,
    extractRuntime: true,
    artifacts: [
      {
        name: `parakeet-linux-${architecture.release}`,
        relative: "bin/parakeet",
        url: `https://github.com/achetronic/parakeet/releases/download/${PARAKEET_VERSION}/parakeet-linux-${architecture.release}`,
        size: binary.size,
        sha256: binary.sha256,
      },
      {
        name: runtime.name,
        relative: "runtime.tgz",
        url: `https://github.com/microsoft/onnxruntime/releases/download/v${ONNXRUNTIME_VERSION}/${runtime.name}`,
        size: runtime.size,
        sha256: runtime.sha256,
      },
      ...Object.entries(PARAKEET_FILES).map(([name, [size, sha256]]) => ({
        name,
        relative: `models/${name}`,
        url: `${HUGGING_FACE}/${PARAKEET_REPOSITORY}/resolve/${PARAKEET_REVISION}/${name}`,
        size,
        sha256,
      })),
      { ...SILERO, relative: "models/silero_vad.onnx" },
    ],
  };
}

export function getVoiceModelManifest(model, architecture) {
  return model.engine === "parakeet" ? parakeetManifest(architecture) : whisperManifest(model);
}
