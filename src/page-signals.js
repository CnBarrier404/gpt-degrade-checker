(() => {
  "use strict";

  const originalFetch = window.fetch;
  const source = "gpt-degrade-checker:model";
  const replaySource = "gpt-degrade-checker:request-latest";
  const maxBytes = 256 * 1024;
  let latestSignal = null;

  window.addEventListener("message", event => {
    if (event.source === window && event.data?.source === replaySource && latestSignal) {
      window.postMessage(latestSignal, "*");
    }
  });

  function emit(data) {
    latestSignal = { source, ...data, at: Date.now() };
    window.postMessage(latestSignal, "*");
  }

  function unavailable(conversationId, reason) {
    emit({ kind: "unavailable", conversation_id: conversationId, reason });
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url || "";
  }

  function conversationRequest(input, init) {
    const url = requestUrl(input);
    const method = (init?.method || input?.method || "GET").toUpperCase();
    if (method === "POST" && /\/backend-api\/(?:f\/)?conversation(?:\/|\?|$)/.test(url)) {
      return { kind: "post" };
    }
    const opened = method === "GET" &&
      url.match(/\/backend-api\/(?:f\/)?conversation\/([0-9a-f-]{8,})(?:\/|\?|$)/i);
    return opened ? { kind: "opened", id: opened[1] } : null;
  }

  async function requestedModel(input, init) {
    try {
      const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
      if (typeof body !== "string") return null;
      const model = JSON.parse(body).model;
      return typeof model === "string" && model ? model : null;
    } catch {
      return null;
    }
  }

  function fields() {
    return { model_slug: null, default_model_slug: null, resolved_model_slug: null };
  }

  function collect(value, result, depth = 0) {
    if (!value || typeof value !== "object" || depth > 5) return;
    const metadata = value.metadata;
    if (metadata && typeof metadata === "object") {
      for (const key of Object.keys(result)) {
        if (!result[key] && typeof metadata[key] === "string" && metadata[key]) {
          result[key] = metadata[key];
        }
      }
    }
    if (value.message) collect(value.message, result, depth + 1);
    if (value.v) collect(value.v, result, depth + 1);
    if (value.mapping && typeof value.mapping === "object") {
      for (const item of Object.values(value.mapping)) collect(item, result, depth + 1);
    }
  }

  function hasSignal(result) {
    return Boolean(result.model_slug || result.default_model_slug || result.resolved_model_slug);
  }

  function publish(result, requested, conversationId) {
    if (!hasSignal(result)) return false;
    emit({
      kind: "model",
      model_slug: result.model_slug,
      default_model_slug: result.default_model_slug,
      resolved_model_slug: result.resolved_model_slug,
      requested_model: requested,
      conversation_id: conversationId
    });
    return true;
  }

  function openedConversationFields(conversation) {
    const mapping = conversation?.mapping;
    const fallback = fields();
    if (typeof conversation?.default_model_slug === "string") {
      fallback.default_model_slug = conversation.default_model_slug;
    }
    if (!mapping || typeof mapping !== "object") return hasSignal(fallback) ? fallback : null;
    const candidates = [];
    let nodeId = conversation.current_node;
    const visited = new Set();
    while (nodeId && !visited.has(nodeId) && mapping[nodeId]) {
      visited.add(nodeId);
      candidates.push(mapping[nodeId]);
      nodeId = mapping[nodeId].parent;
    }
    candidates.push(...Object.entries(mapping)
      .filter(([id]) => !visited.has(id))
      .map(([, node]) => node)
      .sort((a, b) => (b?.message?.create_time || 0) - (a?.message?.create_time || 0)));
    for (const node of candidates) {
      const message = node?.message;
      if (message?.author?.role !== "assistant") continue;
      const result = fields();
      collect(message, result);
      if (!hasSignal(result)) continue;
      result.default_model_slug ||= fallback.default_model_slug;
      return result;
    }
    return hasSignal(fallback) ? fallback : null;
  }

  async function inspectEvents(response, requested) {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const result = fields();
    let pending = "";
    let bytes = 0;
    let conversationId = null;
    try {
      while (bytes < maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        pending += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const event = JSON.parse(data);
            collect(event, result);
            if (!conversationId && typeof event.conversation_id === "string") {
              conversationId = event.conversation_id;
            }
            if (result.resolved_model_slug &&
                (result.model_slug || result.default_model_slug)) {
              publish(result, requested, conversationId);
              return;
            }
          } catch { /* Ignore non-JSON event lines. */ }
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    publish(result, requested, conversationId);
  }

  async function inspect(response, requested, request) {
    try {
      if (!response.ok) {
        if (request.kind === "opened") {
          unavailable(request.id, `对话请求失败（HTTP ${response.status}）`);
        }
        return;
      }
      const type = response.headers.get("content-type") || "";
      if (request.kind === "opened") {
        if (!type.includes("application/json")) {
          unavailable(request.id, "对话响应不是 JSON");
          return;
        }
        const conversation = await response.json();
        const result = openedConversationFields(conversation);
        if (result) publish(result, null, request.id);
        else unavailable(request.id, "响应中没有模型字段");
        return;
      }
      if (type.includes("text/event-stream")) {
        await inspectEvents(response, requested);
      } else if (type.includes("application/json")) {
        const result = fields();
        const body = await response.json();
        collect(body, result);
        publish(result, requested, body?.conversation_id ?? null);
      }
    } catch {
      if (request.kind === "opened") unavailable(request.id, "读取模型字段失败");
    }
  }

  window.fetch = function (...args) {
    const request = conversationRequest(args[0], args[1]);
    if (!request) return originalFetch.apply(this, args);
    const requested = request.kind === "post" ? requestedModel(args[0], args[1]) : Promise.resolve(null);
    return originalFetch.apply(this, args).then(response => {
      try {
        const copy = response.clone();
        requested.then(model => inspect(copy, model, request)).catch(() => {});
      } catch { /* Inspection must never change ChatGPT's response. */ }
      return response;
    });
  };
})();
