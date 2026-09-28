(() => {
  "use strict";

  const host = document.createElement("div");
  host.id = "gpt-degrade-checker";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .card {
      --accent: #749380;
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      box-sizing: border-box;
      max-width: min(360px, calc(100vw - 36px));
      padding: 12px 15px;
      border: 1px solid #e7e8e7;
      border-radius: 14px;
      background: #fff;
      color: #202522;
      box-shadow: 0 8px 28px rgba(22, 31, 25, .10), 0 1px 3px rgba(22, 31, 25, .04);
      font: 13px/1.45 system-ui, sans-serif;
    }
    .card[data-tone="danger"] { --accent: #d35f55; }
    .card[data-tone="uncertain"] { --accent: #c58b37; }
    .title { display: flex; align-items: center; gap: 9px; font-weight: 650; }
    .title::before {
      content: "";
      flex: none;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
    }
    .details { margin: 4px 0 0 16px; color: #6b746d; font-size: 12px; overflow-wrap: anywhere; white-space: pre-line; }
    @media (prefers-color-scheme: dark) {
      .card {
        border-color: #3a403b;
        background: #242a26;
        color: #f1f4f0;
        box-shadow: 0 8px 28px rgba(0, 0, 0, .28);
      }
      .details { color: #afb9b0; }
    }
  `;
  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "等待模型信号";
  const details = document.createElement("div");
  details.className = "details";
  details.textContent = "打开对话或发送消息后显示检测结果";
  card.append(title, details);
  shadow.append(style, card);
  document.documentElement.append(host);

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "gpt-degrade-checker:model") return;
    const activeConversation = location.pathname.match(/^\/c\/([0-9a-f-]{8,})/i)?.[1];
    if (activeConversation && event.data.conversation_id &&
        event.data.conversation_id !== activeConversation) return;
    if (event.data.kind === "unavailable") {
      title.textContent = "该对话暂无模型信号";
      details.textContent = typeof event.data.reason === "string" && event.data.reason.length <= 100
        ? event.data.reason : "响应中没有模型字段";
      card.dataset.tone = "uncertain";
      return;
    }
    if (event.data.kind !== "model") return;
    const model = value => typeof value === "string" && value.length <= 100 && value.trim()
      ? value : null;
    const selected = model(event.data.model_slug) || model(event.data.default_model_slug) ||
      model(event.data.requested_model);
    const resolved = model(event.data.resolved_model_slug);
    if (!selected && !resolved) return;
    if (!selected || !resolved) {
      title.textContent = "模型信号不完整";
      details.textContent = selected
        ? `选择：${selected}\n实际：未返回`
        : `选择：未返回\n实际：${resolved}`;
      card.dataset.tone = "uncertain";
      return;
    }
    const direction = GptDegradeClassifier.direction(selected, resolved);
    const labels = {
      none: "模型一致",
      downgrade: "检测到模型降级",
      upgrade: "模型切换：更高等级",
      lateral: "模型切换：未判为降级",
      unknown: "模型不同：无法判断等级"
    };
    title.textContent = labels[direction];
    details.textContent = `选择：${selected}\n实际：${resolved}`;
    card.dataset.tone = direction === "downgrade" ? "danger" :
      direction === "unknown" ? "uncertain" : "normal";
  });

  window.postMessage({ source: "gpt-degrade-checker:request-latest" }, "*");
})();
