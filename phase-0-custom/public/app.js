const empty = document.querySelector("#empty");
const chat = document.querySelector("#chat");
const events = document.querySelector("#events");
const prompt = document.querySelector("#prompt");
let socket;

function append(kind, text) {
  const item = document.createElement("article");
  item.className = kind;
  item.textContent = text;
  events.append(item);
  item.scrollIntoView({ behavior: "smooth" });
}

async function createChat() {
  const response = await fetch("/v0/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("Could not start Pi");
  const session = await response.json();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}${session.streamUrl}`);
  socket.onmessage = ({ data }) => {
    try {
      const event = JSON.parse(data);
      if (["message_update", "assistant_message"].includes(event.type)) append("assistant", event.delta || event.message?.content || JSON.stringify(event));
      else if (event.type.endsWith("error")) append("error", event.message);
    } catch { append("assistant", data); }
  };
  empty.hidden = true;
  chat.hidden = false;
  prompt.focus();
}

document.querySelector("#new").addEventListener("click", () => createChat().catch((error) => append("error", error.message)));
document.querySelector("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const message = prompt.value.trim();
  if (!message || socket?.readyState !== WebSocket.OPEN) return;
  append("user", message);
  socket.send(JSON.stringify({ type: "prompt", message }));
  prompt.value = "";
});

