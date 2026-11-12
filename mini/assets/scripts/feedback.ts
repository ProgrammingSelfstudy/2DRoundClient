export type FeedbackResult =
  | { status: "sent"; id: number }
  | { status: "rejected" | "unknown"; message: string };

interface FeedbackOptions {
  snapshot(): string;
  submit(title: string, content: string, operationLog: string): Promise<FeedbackResult>;
  draftKey: string;
}

interface Draft {
  title: string;
  content: string;
  operationLog: string;
  unknown: boolean;
}

const TITLE_LIMIT = 50;
const CONTENT_LIMIT = 500;
const emptyDraft = (): Draft => ({ title: "", content: "", operationLog: "", unknown: false });
const limit = (value: string, maximum: number) => Array.from(value).slice(0, maximum).join("");

const style = `
.round-feedback {
  --paper: #2a1b13;
  --panel: #36241a;
  --ink: #fff0d5;
  --muted: #e1c5a5;
  --edge: #8d633d;
  --accent: #efbc72;
  position: fixed;
  inset: 0;
  z-index: 11000;
  pointer-events: none;
  color-scheme: dark;
  font-family: "Source Sans 3", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
}
.round-feedback [hidden] { display: none !important; }
.round-feedback button,
.round-feedback input,
.round-feedback textarea { box-sizing: border-box; font: inherit; }
.round-feedback button {
  min-height: 44px;
  border: 1px solid var(--edge);
  border-radius: 8px;
  padding: 8px 13px;
  color: var(--ink);
  background: #533620;
  cursor: pointer;
}
.round-feedback button:not(:disabled):hover { background: #68452a; }
.round-feedback button:disabled { cursor: default; opacity: 0.7; }
.round-feedback :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.round-feedback .feedback-trigger {
  position: absolute;
  top: calc(58% - 22px);
  right: max(calc(env(safe-area-inset-right) + 8px), calc((100vw - 56.25vh) / 2 + 8px));
  pointer-events: auto;
  min-width: 52px;
  padding: 6px 8px;
  font-size: 15px;
  background: var(--paper);
  touch-action: manipulation;
}
.round-feedback dialog {
  --pad-top: max(14px, env(safe-area-inset-top));
  --pad-bottom: max(14px, env(safe-area-inset-bottom));
  position: fixed;
  box-sizing: border-box;
  inset: auto 0;
  top: calc(var(--viewport-top, 0px) + (var(--viewport-height, 100vh) + var(--pad-top) - var(--pad-bottom)) / 2);
  width: min(440px, calc(100vw - 28px), max(300px, calc(56.25vh - 28px)));
  max-height: calc(var(--viewport-height, 100vh) - var(--pad-top) - var(--pad-bottom));
  margin: 0 auto;
  padding: 18px;
  transform: translateY(-50%);
  pointer-events: auto;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--edge);
  border-radius: 14px;
  color: var(--ink);
  background: var(--paper);
  text-align: left;
}
.round-feedback dialog::backdrop { background: rgba(16, 10, 7, 0.72); }
.round-feedback .feedback-heading,
.round-feedback .feedback-field-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.round-feedback h2 { margin: 0; font-size: 21px; line-height: 1.25; }
.round-feedback h2:focus { outline: none; }
.round-feedback .feedback-field { display: grid; gap: 6px; margin-top: 15px; }
.round-feedback .feedback-count,
.round-feedback .feedback-help { color: var(--muted); font-size: 14px; }
.round-feedback .feedback-count { font-variant-numeric: tabular-nums; }
.round-feedback input,
.round-feedback textarea {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 9px 10px;
  border: 1px solid var(--edge);
  border-radius: 8px;
  color: var(--ink);
  background: var(--panel);
  line-height: 1.45;
  caret-color: var(--accent);
}
.round-feedback input::placeholder,
.round-feedback textarea::placeholder { color: var(--muted); opacity: 1; }
.round-feedback textarea { min-height: 94px; resize: vertical; }
.round-feedback [aria-invalid="true"] { border-color: #ffad95; }
.round-feedback details { margin-top: 12px; }
.round-feedback summary { min-height: 44px; padding-block: 10px; box-sizing: border-box; cursor: pointer; color: var(--ink); }
.round-feedback .feedback-help { margin: 0 0 6px; line-height: 1.45; }
.round-feedback pre {
  max-height: 160px;
  overflow: auto;
  overscroll-behavior: contain;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0 0 8px;
  padding: 9px 10px;
  border-radius: 8px;
  color: var(--ink);
  background: var(--panel);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.round-feedback .feedback-status { margin: 10px 0 0; line-height: 1.45; color: var(--muted); }
.round-feedback .feedback-status[data-error="true"] { color: #ffb7a3; }
.round-feedback .feedback-status:empty { margin: 0; }
.round-feedback .feedback-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.round-feedback .feedback-submit { color: #2a180d; background: var(--accent); border-color: var(--accent); font-weight: 600; }
.round-feedback .feedback-submit:not(:disabled):hover { background: #ffd89c; }
.round-feedback .feedback-copy-text { margin-top: 10px; }
`;

function readDraft(key: string): Draft {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Draft> | null;
    if (stored && typeof stored.title === "string" && typeof stored.content === "string") {
      return {
        title: limit(stored.title, TITLE_LIMIT),
        content: limit(stored.content, CONTENT_LIMIT),
        operationLog: typeof stored.operationLog === "string" ? stored.operationLog : "",
        unknown: stored.unknown === true
      };
    }
  } catch { /* Storage can be unavailable. */ }
  return emptyDraft();
}

let disposeCurrent: (() => void) | undefined;

export function mountFeedback(options: FeedbackOptions): () => void {
  disposeCurrent?.();

  const root = document.createElement("div");
  root.className = "round-feedback";
  root.innerHTML = `
    <button type="button" class="feedback-trigger" aria-haspopup="dialog" aria-controls="round-feedback-dialog">反馈</button>
    <dialog id="round-feedback-dialog" aria-labelledby="round-feedback-title">
      <div class="feedback-heading">
        <h2 id="round-feedback-title" tabindex="-1">游戏反馈</h2>
        <button type="button" class="feedback-close">关闭</button>
      </div>
      <form novalidate>
        <div class="feedback-field">
          <div class="feedback-field-row">
            <label for="round-feedback-subject">标题</label>
            <span class="feedback-count" id="round-feedback-title-count"></span>
          </div>
          <input id="round-feedback-subject" type="text" placeholder="例如：挑战首关后卡在结算" aria-describedby="round-feedback-title-count" required>
        </div>
        <div class="feedback-field">
          <div class="feedback-field-row">
            <label for="round-feedback-content">发生了什么</label>
            <span class="feedback-count" id="round-feedback-content-count"></span>
          </div>
          <textarea id="round-feedback-content" rows="3" placeholder="写下你做了什么、看到什么" aria-describedby="round-feedback-content-count" required></textarea>
        </div>
        <details>
          <summary>查看随反馈提交的操作记录</summary>
          <pre class="feedback-log"></pre>
        </details>
        <p class="feedback-status" role="status" aria-live="polite"></p>
        <textarea class="feedback-copy-text" rows="3" readonly aria-label="可手动复制的草稿" hidden></textarea>
        <div class="feedback-actions">
          <button type="button" class="feedback-copy" hidden>复制草稿</button>
          <button type="button" class="feedback-new" hidden>新建反馈</button>
          <button type="submit" class="feedback-submit">提交反馈</button>
        </div>
      </form>
    </dialog>`;
  const sheet = document.createElement("style");
  sheet.textContent = style;
  root.append(sheet);
  document.body.append(root);

  const select = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const trigger = select<HTMLButtonElement>(".feedback-trigger");
  const dialog = select<HTMLDialogElement>("dialog");
  const heading = select<HTMLElement>("h2");
  const form = select<HTMLFormElement>("form");
  const title = select<HTMLInputElement>("#round-feedback-subject");
  const content = select<HTMLTextAreaElement>("#round-feedback-content");
  const titleCount = select<HTMLElement>("#round-feedback-title-count");
  const contentCount = select<HTMLElement>("#round-feedback-content-count");
  const operationLog = select<HTMLElement>(".feedback-log");
  const status = select<HTMLElement>(".feedback-status");
  const copy = select<HTMLButtonElement>(".feedback-copy");
  const copyText = select<HTMLTextAreaElement>(".feedback-copy-text");
  const startNew = select<HTMLButtonElement>(".feedback-new");
  const send = select<HTMLButtonElement>(".feedback-submit");
  const details = select<HTMLDetailsElement>("details");
  const fields = root.querySelectorAll<HTMLElement>(".feedback-field");

  let draft = readDraft(options.draftKey);
  let state: "editing" | "sending" | "rejected" | "unknown" | "sent" = draft.unknown ? "unknown" : "editing";
  let confirmNew = false;
  let disposed = false;

  const hasText = () => Boolean(draft.title || draft.content);
  const persist = () => {
    try {
      if (hasText() || draft.unknown) localStorage.setItem(options.draftKey, JSON.stringify(draft));
      else localStorage.removeItem(options.draftKey);
    } catch { /* The current form still holds the draft. */ }
  };
  const message = (text: string, error = false) => {
    status.textContent = text;
    status.dataset.error = String(error);
  };
  const counters = () => {
    titleCount.textContent = `${Array.from(title.value).length} / ${TITLE_LIMIT}`;
    contentCount.textContent = `${Array.from(content.value).length} / ${CONTENT_LIMIT}`;
  };
  const render = () => {
    const editable = state === "editing" || state === "rejected";
    const sent = state === "sent";
    fields.forEach(field => { field.hidden = sent; });
    details.hidden = sent;
    title.readOnly = content.readOnly = !editable;
    send.disabled = state === "sending";
    send.hidden = state === "unknown" || state === "sent";
    send.textContent = state === "sending" ? "提交中…" : state === "rejected" ? "重试提交" : "提交反馈";
    copy.hidden = !(state === "unknown" || state === "rejected") || !hasText();
    startNew.hidden = state !== "unknown";
    startNew.textContent = confirmNew ? "清空并新建" : "新建反馈";
    counters();
  };
  const refreshViewport = () => {
    const viewport = window.visualViewport;
    root.style.setProperty("--viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    root.style.setProperty("--viewport-top", `${viewport?.offsetTop ?? 0}px`);
  };
  const showDraft = () => {
    title.value = draft.title;
    content.value = draft.content;
    operationLog.textContent = draft.operationLog || "暂无操作记录";
    title.removeAttribute("aria-invalid");
    content.removeAttribute("aria-invalid");
    copyText.hidden = true;
    render();
  };
  const begin = () => {
    draft = emptyDraft();
    state = "editing";
    confirmNew = false;
    message("");
    try { draft.operationLog = options.snapshot(); } catch { /* Feedback remains available. */ }
    details.open = false;
    showDraft();
  };

  trigger.addEventListener("click", () => {
    if (dialog.open) return;
    if (state === "sent" || (state === "editing" && !hasText())) begin();
    else {
      showDraft();
      if (state === "unknown" && !status.textContent) message("上次反馈可能已经送达。可先复制草稿并核对。", true);
    }
    refreshViewport();
    dialog.showModal();
    heading.focus({ preventScroll: true });
  });

  select<HTMLButtonElement>(".feedback-close").addEventListener("click", () => dialog.close());
  details.addEventListener("toggle", () => {
    if (details.open) operationLog.scrollTop = operationLog.scrollHeight;
  });
  dialog.addEventListener("close", () => {
    confirmNew = false;
    if (!disposed) {
      render();
      trigger.focus({ preventScroll: true });
    }
  });

  function trackInput(field: HTMLInputElement | HTMLTextAreaElement, key: "title" | "content", maximum: number) {
    const update = () => {
      if (field.readOnly) return;
      const value = limit(field.value, maximum);
      if (value !== field.value) field.value = value;
      draft[key] = value;
      field.removeAttribute("aria-invalid");
      counters();
      persist();
    };
    field.addEventListener("input", event => {
      if (!(event as InputEvent).isComposing) update();
    });
    field.addEventListener("compositionend", update);
  }
  trackInput(title, "title", TITLE_LIMIT);
  trackInput(content, "content", CONTENT_LIMIT);

  copy.addEventListener("click", async () => {
    const value = [draft.title, draft.content, draft.operationLog && `操作记录\n${draft.operationLog}`]
      .filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(value);
      if (!disposed && dialog.open) message("草稿已复制。");
    } catch {
      if (disposed || !dialog.open) return;
      copyText.value = value;
      copyText.hidden = false;
      copyText.focus();
      copyText.select();
      message("请选中文字后手动复制。");
    }
  });
  startNew.addEventListener("click", () => {
    if (!confirmNew) {
      confirmNew = true;
      message("新建会清空当前草稿。需要保留时请先复制。", true);
      render();
      return;
    }
    begin();
    persist();
    heading.focus({ preventScroll: true });
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (state !== "editing" && state !== "rejected") return;
    draft.title = limit(title.value, TITLE_LIMIT);
    draft.content = limit(content.value, CONTENT_LIMIT);
    persist();
    const invalid = !draft.title.trim() ? title : !draft.content.trim() ? content : null;
    if (invalid) {
      invalid.setAttribute("aria-invalid", "true");
      message(invalid === title ? "请输入标题。" : "请输入发生的问题。", true);
      invalid.focus();
      return;
    }
    if (navigator.onLine === false) {
      state = "rejected";
      message("网络已断开。草稿已保留，联网后可以重试。", true);
      render();
      return;
    }
    state = "sending";
    copyText.hidden = true;
    message("正在提交反馈…");
    // Persist a pending submission before it can leave the browser, including across a reload.
    draft.unknown = true;
    persist();
    render();
    let result: FeedbackResult;
    try {
      result = await options.submit(draft.title.trim(), draft.content.trim(), draft.operationLog);
    } catch {
      result = { status: "unknown", message: "暂时无法确认反馈是否送达。" };
    }
    if (disposed) return;
    if (result.status === "sent") {
      draft = emptyDraft();
      state = "sent";
      message(`反馈已提交，编号 #${result.id}。`);
    } else {
      draft.unknown = result.status === "unknown";
      state = result.status;
      message(result.message || (draft.unknown ? "暂时无法确认反馈是否送达。" : "提交失败，请重试。"), true);
    }
    persist();
    showDraft();
    if (state === "sent" && dialog.open) status.scrollIntoView({ block: "nearest" });
  });

  // A click, scroll or keystroke in the HTML overlay belongs to the feedback UI.
  for (const type of ["pointerdown", "pointerup", "touchstart", "touchmove", "touchend", "keydown", "keyup", "click", "wheel"]) {
    root.addEventListener(type, event => event.stopPropagation());
  }
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", refreshViewport);
  viewport?.addEventListener("scroll", refreshViewport);
  window.addEventListener("resize", refreshViewport);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    viewport?.removeEventListener("resize", refreshViewport);
    viewport?.removeEventListener("scroll", refreshViewport);
    window.removeEventListener("resize", refreshViewport);
    if (dialog.open) dialog.close();
    root.remove();
    if (disposeCurrent === dispose) disposeCurrent = undefined;
  };
  disposeCurrent = dispose;
  return dispose;
}
