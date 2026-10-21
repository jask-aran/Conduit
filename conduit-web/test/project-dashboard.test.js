import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectDashboard } from "../src/project-dashboard.js";

const project = {
  id: "project_workspace",
  slug: "workspace",
  name: "Workspace",
  kind: "workspace",
  origin: "linked",
  path: "/srv/stale-workspace",
  workingRoot: "/srv/workspace",
  externalPath: "/srv/workspace",
  createdAt: "2026-07-01T00:00:00.000Z",
  defaultTemplateId: "workspace",
  deletesFilesOnRemove: false,
};

function message(role, content, timestamp) {
  return { type: "message", timestamp, message: { role, content } };
}

test("project dashboard stays registry-bounded and enriches only recent active chats", async () => {
  const chats = [
    {
      id: "chat_recent",
      projectId: project.id,
      status: "active",
      title: "Recent",
      backend: { implementation: "conduit-runtime", opaqueSession: "1" },
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-28T01:00:00.000Z",
    },
    {
      id: "chat_older",
      projectId: project.id,
      status: "active",
      title: "Older",
      backend: { implementation: "conduit-runtime", opaqueSession: "2" },
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-27T01:00:00.000Z",
    },
    {
      id: "chat_draft",
      projectId: project.id,
      status: "draft",
      title: "Draft",
      createdAt: "2026-07-28T02:00:00.000Z",
      updatedAt: "2026-07-28T02:00:00.000Z",
    },
  ];
  const transcriptReads = [];
  const dashboard = await buildProjectDashboard({
    project,
    registry: { listProject: (id) => id === project.id ? chats : [] },
    processes: [{
      id: "process_recent",
      chatId: "chat_recent",
      projectId: project.id,
      status: "running",
      activity: "working",
      active: true,
    }],
    terminals: [{ id: "pty_running", projectId: project.id, status: "running" }, { id: "pty_exited", projectId: project.id, status: "exited" }],
    readTranscript: async (chat) => {
      transcriptReads.push(chat.id);
      return { messages: [
        message("user", "Please inspect the dashboard", "2026-07-28T01:00:00.000Z"),
        message("assistant", chat.id === "chat_recent" ? "The recent dashboard result\nis ready." : "Older result", "2026-07-28T01:01:00.000Z"),
      ].map(({ message, timestamp }) => ({ ...message, timestamp })) };
    },
    inspectWorkspace: async () => ({
      repository: true,
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 2,
      commits: [{ authoredAt: "2026-07-27T22:00:00.000Z" }],
      files: [{ status: " M", path: "src/server.js" }],
    }),
  });

  assert.equal(dashboard.identity.path, project.workingRoot);
  assert.equal(dashboard.identity.workingRoot, project.workingRoot);
  assert.deepEqual(dashboard.stats, {
    totalChats: 3,
    activeChats: 2,
    liveChats: 1,
    liveTerminals: 1,
    lastActivityAt: "2026-07-28T01:00:00.000Z",
  });
  assert.deepEqual(dashboard.recentChats.map((chat) => chat.id), ["chat_recent", "chat_older"]);
  assert.equal(dashboard.recentChats[0].lastMessagePreview, "The recent dashboard result is ready.");
  assert.equal(dashboard.recentChats[0].liveActivity, "working");
  assert.deepEqual(transcriptReads, ["chat_recent", "chat_older"]);
  assert.deepEqual(dashboard.git, {
    branch: "main",
    upstream: "origin/main",
    ahead: 1,
    behind: 2,
    lastCommitAt: "2026-07-27T22:00:00.000Z",
    hasUnstaged: true,
    changedFiles: 1,
  });
});

test("managed project dashboard skips Git inspection", async () => {
  let inspected = false;
  const dashboard = await buildProjectDashboard({
    project: { ...project, kind: "project", origin: "managed" },
    registry: { listProject: () => [] },
    processes: [],
    inspectWorkspace: async () => { inspected = true; return { repository: true }; },
  });

  assert.equal(inspected, false);
  assert.equal(dashboard.git, null);
  assert.deepEqual(dashboard.recentChats, []);
});

test("project dashboard caps transcript enrichment at ten recent chats", async () => {
  const chats = Array.from({ length: 14 }, (_, index) => ({
    id: `chat_${index}`,
    projectId: project.id,
    status: "active",
    title: `Chat ${index}`,
    backend: { implementation: "conduit-runtime", opaqueSession: String(index) },
    createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const transcriptReads = [];
  const dashboard = await buildProjectDashboard({
    project,
    registry: { listProject: () => chats },
    processes: [],
    readTranscript: async (chat) => {
      transcriptReads.push(chat.id);
      return { messages: [] };
    },
    inspectWorkspace: async () => ({ repository: false }),
  });

  assert.equal(dashboard.stats.activeChats, 14);
  assert.equal(dashboard.recentChats.length, 10);
  assert.equal(transcriptReads.length, 10);
  assert.deepEqual(
    dashboard.recentChats.map((chat) => chat.id),
    ["chat_13", "chat_12", "chat_11", "chat_10", "chat_9", "chat_8", "chat_7", "chat_6", "chat_5", "chat_4"],
  );
});
