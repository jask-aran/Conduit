import { useCallback, useRef, useState } from "react";
import { UploadCloudIcon } from "lucide-react";

export function useChatDrop(onFiles) {
  const counter = useRef(0);
  const [active, setActive] = useState(false);
  const isFileDrag = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
  const onDragEnter = useCallback((event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    counter.current += 1;
    setActive(true);
  }, []);
  const onDragLeave = useCallback((event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    counter.current = Math.max(0, counter.current - 1);
    if (!counter.current) setActive(false);
  }, []);
  const onDragOver = useCallback((event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);
  const onDrop = useCallback((event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    counter.current = 0;
    setActive(false);
    onFiles(event.dataTransfer.files || []);
  }, [onFiles]);
  return { active, handlers: { onDragEnter, onDragLeave, onDragOver, onDrop } };
}

export function ChatDropOverlay({ active }) {
  if (!active) return null;
  return <div className="chat-drop-overlay" aria-hidden="true">
    <div><UploadCloudIcon /><strong>Drop files to attach</strong></div>
  </div>;
}
