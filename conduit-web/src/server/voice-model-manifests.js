function huggingFaceBase() {
  const endpoint = process.env.CONDUIT_HF_ENDPOINT;
  return (endpoint || "https://huggingface.co").replace(/\/+$/, "");
}

const PARAKEET_VERSION = "v0.8.0";
export const ONNXRUNTIME_VERSION = "1.25.1";
export const TRANSCRIBE_CPP_VERSION = "0.1.3";
export const TRANSCRIBE_CPP_RUNTIME = Object.freeze({
  package: "transcribe-cpp",
  version: TRANSCRIBE_CPP_VERSION,
  headerHash: "86b16dd97ad1cb58",
  platforms: Object.freeze({
    "linux-x64-cpu-vulkan": Object.freeze({
      package: "@transcribe-cpp/linux-x64-cpu-vulkan",
      release: "transcribe-native-0.1.3-linux-x86_64-cpu-vulkan.tar.gz",
      size: 29703996,
      sha256: "5e150c7862748d33dc2f559a38274bcb46d06ba63f8f5d1247f8196569e02797",
    }),
    "linux-arm64-cpu-vulkan": Object.freeze({
      package: "@transcribe-cpp/linux-arm64-cpu-vulkan",
      release: "transcribe-native-0.1.3-linux-aarch64-cpu-vulkan.tar.gz",
      size: 26134718,
      sha256: "ba003aed1c4edb86d2c6b44eb5c0386b21b939505c139d8b58afc80439866f65",
    }),
  }),
});

const TRANSCRIBE_CPP_MODEL_FILE = "parakeet-unified-en-0.6b-Q8_0.gguf";
const TRANSCRIBE_CPP_MODEL_REPOSITORY = "handy-computer/parakeet-unified-en-0.6b-gguf";
const TRANSCRIBE_CPP_MODEL_REVISION = "7e948f21b7bdbac698d3318db9d350f1096f3b6c";
const TRANSCRIBE_CPP_SOURCE_REVISION = "d4ac9928f3bf238223ff0779c06b8149bf8ac4e1";
const TRANSCRIBE_CPP_MODEL_SIZE = 731357568;
const TRANSCRIBE_CPP_MODEL_SHA256 = "4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795";

const WHISPER_FILES = Object.freeze([
  "added_tokens.json", "config.json", "generation_config.json", "merges.txt", "normalizer.json", "preprocessor_config.json",
  "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json",
  "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
]);

const WHISPER_FP32_FILES = Object.freeze([
  "added_tokens.json", "config.json", "generation_config.json", "merges.txt", "normalizer.json", "preprocessor_config.json",
  "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json",
  "onnx/encoder_model.onnx", "onnx/decoder_model_merged.onnx",
]);

const WHISPER_Q8_MANIFESTS = Object.freeze({
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
  "whisper-large-v3-turbo-q8": Object.freeze({
    repository: "onnx-community/whisper-large-v3-turbo",
    revision: "360ebcde2559d60bb474678be3c1de9ef347d01a",
    files: Object.freeze({
      "added_tokens.json": [34648, "3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0"],
      "config.json": [1332, "35cd83669f75bc2867f3b3a4461850392d5e308cd6ea951c3700539883c28df1"],
      "generation_config.json": [3897, "16f95291d2f47c944d3c2b19390bba7965666555c1ea2a0bdc850d1fab45612f"],
      "merges.txt": [493869, "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6"],
      "normalizer.json": [52666, "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd"],
      "preprocessor_config.json": [340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"],
      "special_tokens_map.json": [2186, "baea4ea09372eb4fca86b4e4346139fd73cb807d5087e9de0948e971739c3e74"],
      "tokenizer.json": [2480617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"],
      "tokenizer_config.json": [282843, "844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389"],
      "vocab.json": [1036558, "e2aa043ef015641d363d8288e7c241c85e36a5c761fb303598e0710233344387"],
      "onnx/encoder_model_quantized.onnx": [644822195, "d2f853dc3254fdc0079f55dd4433ea716ac98ec5574d3b475f288f2a77cebba9"],
      "onnx/decoder_model_merged_quantized.onnx": [439936716, "61481bd3be3a445d5a4b9070e8f8b2c6cc4fbbbbdc9f0e7ed048a132b8b84e0d"],
    }),
  }),
});

function fullPrecisionEntry(base, encoder, decoder) {
  return Object.freeze({
    repository: base.repository,
    revision: base.revision,
    files: Object.freeze({
      ...base.files,
      "onnx/encoder_model.onnx": encoder,
      "onnx/decoder_model_merged.onnx": decoder,
    }),
    fullPrecision: true,
  });
}

const WHISPER_MANIFESTS = Object.freeze({
  ...WHISPER_Q8_MANIFESTS,
  "whisper-tiny-en-fp32": fullPrecisionEntry(
    WHISPER_Q8_MANIFESTS["whisper-tiny-en-q8"],
    [32904992, "8c361b9430a5ef6619ee64b7fe06c725df19f36d508cc8b847064b34a888a3fe"],
    [118552291, "33581ce4a48f9a59dad036a3939a24f290e0756e05387b977fe6f613460b495e"],
  ),
  "whisper-base-fp32": fullPrecisionEntry(
    WHISPER_Q8_MANIFESTS["whisper-base-q8"],
    [82468078, "a9f3b752833b49e880dec91ee5b6d936112be7c3ea07c221024ba493439f46fe"],
    [208521528, "514903744bb1b45803ec571af99b31110491c6f77b0a154825866995fb124b73"],
  ),
  "whisper-small-fp32": fullPrecisionEntry(
    WHISPER_Q8_MANIFESTS["whisper-small-q8"],
    [352825870, "b37cd6625dc36f9178ec7539a1876b9680ea26a910097e092be39dc766320c7b"],
    [615324301, "6ed5e35feaba79ad2e89b368ddc7b4ddaa3c00b4c37a664375d3428a76fecc6a"],
  ),
});

const PARAKEET_V3_INT8_FILES = Object.freeze({
  "config.json": [97, "666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466"],
  "vocab.txt": [93939, "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"],
  "nemo128.onnx": [139764, "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f"],
  "encoder-model.int8.onnx": [652183999, "6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09"],
  "decoder_joint-model.int8.onnx": [18202004, "eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70"],
});

const PARAKEET_V3_FP32_FILES = Object.freeze({
  "config.json": PARAKEET_V3_INT8_FILES["config.json"],
  "vocab.txt": PARAKEET_V3_INT8_FILES["vocab.txt"],
  "nemo128.onnx": PARAKEET_V3_INT8_FILES["nemo128.onnx"],
  "encoder-model.onnx": [41770866, "98a74b21b4cc0017c1e7030319a4a96f4a9506e50f0708f3a516d02a77c96bb1"],
  "encoder-model.onnx.data": [2435420160, "9a22d372c51455c34f13405da2520baefb7125bd16981397561423ed32d24f36"],
  "decoder_joint-model.onnx": [72520893, "e978ddf6688527182c10fde2eb4b83068421648985ef23f7a86be732be8706c1"],
});

const PARAKEET_V2_INT8_FILES = Object.freeze({
  "config.json": [97, "666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466"],
  "vocab.txt": [9384, "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d"],
  "nemo128.onnx": [139764, "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f"],
  "encoder-model.int8.onnx": [652184014, "3e0581fda6ab843888b51e56d7ee78b6d5bc3237ec113af1f732d1d5286aa155"],
  "decoder_joint-model.int8.onnx": [8998286, "a449f49acd68979d418651dd2dcb737cc0f1bf0225e009e29ee326354edbf7d3"],
});

const PARAKEET_V2_FP32_FILES = Object.freeze({
  "config.json": PARAKEET_V2_INT8_FILES["config.json"],
  "vocab.txt": PARAKEET_V2_INT8_FILES["vocab.txt"],
  "nemo128.onnx": PARAKEET_V2_INT8_FILES["nemo128.onnx"],
  "encoder-model.onnx": [41770866, "3987bcd28175d829d12888a996a84e8f62a0e374d9ffd640662c1515adc679d3"],
  "encoder-model.onnx.data": [2435420160, "4dab7362d4874d85965045b1e41b2d61dd2cc0fb25671a7f6b3dc47bf120cc41"],
  "decoder_joint-model.onnx": [35792059, "cbb52a07bd70ab5b67f8439d4b3cd8704b18467b4430bcacb5adabe154b8d191"],
});

const PARAKEET_PACKAGES = Object.freeze({
  "parakeet-tdt-0.6b-v3-int8": Object.freeze({
    repository: "istupakov/parakeet-tdt-0.6b-v3-onnx",
    revision: "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce",
    files: PARAKEET_V3_INT8_FILES,
  }),
  "parakeet-tdt-0.6b-v3-fp32": Object.freeze({
    repository: "istupakov/parakeet-tdt-0.6b-v3-onnx",
    revision: "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce",
    files: PARAKEET_V3_FP32_FILES,
  }),
  "parakeet-tdt-0.6b-v2-int8": Object.freeze({
    repository: "istupakov/parakeet-tdt-0.6b-v2-onnx",
    revision: "0bbb45a3365852604aef28b538a8f066f4ccaa85",
    files: PARAKEET_V2_INT8_FILES,
  }),
  "parakeet-tdt-0.6b-v2-fp32": Object.freeze({
    repository: "istupakov/parakeet-tdt-0.6b-v2-onnx",
    revision: "0bbb45a3365852604aef28b538a8f066f4ccaa85",
    files: PARAKEET_V2_FP32_FILES,
  }),
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

export const SILERO_VAD_ARTIFACT = Object.freeze({
  name: "silero_vad.onnx",
  url: "https://raw.githubusercontent.com/snakers4/silero-vad/7e30209a3e901f9842f81b225f3e93d8199902b1/src/silero_vad/data/silero_vad.onnx",
  size: 2327524,
  sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
  revision: "7e30209a3e901f9842f81b225f3e93d8199902b1",
  license: "MIT",
  attribution: "Silero Team",
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
    artifacts: [
      ...(definition.fullPrecision ? WHISPER_FP32_FILES : WHISPER_FILES).map((name) => {
      const [size, sha256] = definition.files[name];
      return {
        name,
        relative: name,
        url: `${huggingFaceBase()}/${definition.repository}/resolve/${definition.revision}/${name}`,
        size,
        sha256,
      };
      }),
      { ...SILERO_VAD_ARTIFACT, relative: "models/silero_vad.onnx" },
    ],
  };
}

function parakeetManifest(model, architecture) {
  const pack = PARAKEET_PACKAGES[model.id];
  const binary = PARAKEET_BINARY[architecture.release];
  const runtime = PARAKEET_RUNTIME[architecture.runtime];
  if (!pack || pack.repository !== model.repository || pack.revision !== model.revision) {
    throw manifestError(`No reviewed artifact manifest exists for ${model.label}`);
  }
  if (!binary || !runtime) throw manifestError(`No reviewed Parakeet package exists for ${architecture.release}`);
  return {
    version: PARAKEET_VERSION,
    modelRevision: pack.revision,
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
      ...Object.entries(pack.files).map(([name, [size, sha256]]) => ({
        name,
        relative: `models/${name}`,
        url: `${huggingFaceBase()}/${pack.repository}/resolve/${pack.revision}/${name}`,
        size,
        sha256,
      })),
      { ...SILERO_VAD_ARTIFACT, relative: "models/silero_vad.onnx" },
    ],
  };
}

function transcribeCppManifest(model) {
  if (model.repository !== TRANSCRIBE_CPP_MODEL_REPOSITORY || model.revision !== TRANSCRIBE_CPP_MODEL_REVISION || model.sourceRevision !== TRANSCRIBE_CPP_SOURCE_REVISION) {
    throw manifestError(`No reviewed transcribe.cpp manifest exists for ${model.label}`);
  }
  return {
    version: `transcribe-cpp-${TRANSCRIBE_CPP_VERSION}`,
    modelRevision: model.revision,
    sourceRevision: model.sourceRevision,
    runtime: TRANSCRIBE_CPP_RUNTIME,
    artifacts: [{
      name: TRANSCRIBE_CPP_MODEL_FILE,
      relative: TRANSCRIBE_CPP_MODEL_FILE,
      url: `${huggingFaceBase()}/${TRANSCRIBE_CPP_MODEL_REPOSITORY}/resolve/${TRANSCRIBE_CPP_MODEL_REVISION}/${TRANSCRIBE_CPP_MODEL_FILE}`,
      size: TRANSCRIBE_CPP_MODEL_SIZE,
      sha256: TRANSCRIBE_CPP_MODEL_SHA256,
    }],
  };
}

export function getVoiceModelManifest(model, architecture) {
  if (model.engine === "parakeet") return parakeetManifest(model, architecture);
  if (model.engine === "transcribe-cpp") return transcribeCppManifest(model);
  return whisperManifest(model);
}
