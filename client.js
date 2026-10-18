window.__ModuleLoader__.load({
	id: "dsh-message-edit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared.ts
		/** Same-origin endpoint owned by the Message Edit host plugin. */
		const MESSAGE_EDIT_PATH = "/api/message-edit";
		//#endregion
		//#region src/client/controller.ts
		/** Merge a burst of turn completions into one refresh. */
		const REFRESH_DELAY_MS = 300;
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function objectValue(value, label) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} 不是对象`);
			return value;
		}
		function stringValue(value, label) {
			if (typeof value !== "string") throw new TypeError(`${label} 不是字符串`);
			return value;
		}
		function numberValue(value, label) {
			if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} 不是数字`);
			return value;
		}
		function booleanValue(value, label) {
			if (typeof value !== "boolean") throw new TypeError(`${label} 不是布尔值`);
			return value;
		}
		function blockKind(value) {
			if (value !== "user" && value !== "assistant.reasoning" && value !== "assistant.response") throw new TypeError("消息块类型无效");
			return value;
		}
		function decodeMessage(value, index) {
			const row = objectValue(value, `messages[${String(index)}]`);
			return {
				key: stringValue(row["key"], "消息 key"),
				chatNodeKey: stringValue(row["chatNodeKey"], "消息 chatNodeKey"),
				turn: numberValue(row["turn"], "消息 turn"),
				eventSeq: numberValue(row["eventSeq"], "消息 eventSeq"),
				blockIndex: numberValue(row["blockIndex"], "消息 blockIndex"),
				kind: blockKind(row["kind"]),
				text: stringValue(row["text"], "消息 text"),
				time: numberValue(row["time"], "消息 time")
			};
		}
		function decodeRetryable(value, index) {
			const row = objectValue(value, `retryableTurns[${String(index)}]`);
			return {
				turn: numberValue(row["turn"], "回合 turn"),
				userEventSeq: numberValue(row["userEventSeq"], "回合 userEventSeq"),
				preview: stringValue(row["preview"], "回合 preview"),
				time: numberValue(row["time"], "回合 time")
			};
		}
		function optionalOperation(value) {
			if (value === void 0) return void 0;
			if (value === "edit" || value === "reroll" || value === "retry") return value;
			throw new TypeError("版本 operation 无效");
		}
		function decodeVersion(value, index) {
			const row = objectValue(value, `versions[${String(index)}]`);
			const operation = optionalOperation(row["operation"]);
			const cascade = row["cascade"];
			if (cascade !== void 0 && cascade !== "truncate" && cascade !== "preserve") throw new TypeError("版本 cascade 无效");
			const kind = row["blockKind"] === void 0 ? void 0 : blockKind(row["blockKind"]);
			return {
				sessionId: stringValue(row["sessionId"], "版本 sessionId"),
				...row["parentSessionId"] === void 0 ? {} : { parentSessionId: stringValue(row["parentSessionId"], "版本 parentSessionId") },
				...row["effectId"] === void 0 ? {} : { effectId: stringValue(row["effectId"], "版本 effectId") },
				...row["inverseSessionId"] === void 0 ? {} : { inverseSessionId: stringValue(row["inverseSessionId"], "版本 inverseSessionId") },
				createdAt: numberValue(row["createdAt"], "版本 createdAt"),
				depth: numberValue(row["depth"], "版本 depth"),
				current: booleanValue(row["current"], "版本 current"),
				onCurrentEffectPath: booleanValue(row["onCurrentEffectPath"], "版本 onCurrentEffectPath"),
				...operation === void 0 ? {} : { operation },
				...cascade === void 0 ? {} : { cascade },
				...row["targetTurn"] === void 0 ? {} : { targetTurn: numberValue(row["targetTurn"], "版本 targetTurn") },
				...kind === void 0 ? {} : { blockKind: kind },
				...row["before"] === void 0 ? {} : { before: stringValue(row["before"], "版本 before") },
				...row["after"] === void 0 ? {} : { after: stringValue(row["after"], "版本 after") }
			};
		}
		function arrayValue(value, label) {
			if (!Array.isArray(value)) throw new TypeError(`${label} 不是数组`);
			return value;
		}
		function stringArray(value, label) {
			return arrayValue(value, label).map((item, index) => stringValue(item, `${label}[${String(index)}]`));
		}
		function decodeTimeline(value) {
			const data = objectValue(value, "Timeline 响应");
			return {
				sessionId: stringValue(data["sessionId"], "Timeline sessionId"),
				messages: arrayValue(data["messages"], "Timeline messages").map(decodeMessage),
				retryableTurns: arrayValue(data["retryableTurns"], "Timeline retryableTurns").map(decodeRetryable),
				versions: arrayValue(data["versions"], "Timeline versions").map(decodeVersion),
				undoStack: stringArray(data["undoStack"], "Timeline undoStack"),
				redoSessionIds: stringArray(data["redoSessionIds"], "Timeline redoSessionIds")
			};
		}
		function decodeOperationResult(value) {
			const data = objectValue(value, "操作响应");
			return {
				sessionId: stringValue(data["sessionId"], "操作 sessionId"),
				queuedTurns: numberValue(data["queuedTurns"], "操作 queuedTurns")
			};
		}
		async function responseValue(response) {
			const value = await response.json();
			if (response.ok) return value;
			const error = objectValue(value, "错误响应")["error"];
			throw new Error(typeof error === "string" ? error : `请求失败：HTTP ${String(response.status)}`);
		}
		function conversationRevision(snapshot) {
			return [
				snapshot.openState,
				snapshot.removed,
				snapshot.hasMore,
				snapshot.running
			].join("|");
		}
		function lineageRevision(snapshot, sessionId) {
			let root = sessionId;
			const ancestorIds = /* @__PURE__ */ new Set();
			while (!ancestorIds.has(root)) {
				ancestorIds.add(root);
				const parent = snapshot.byId[root]?.parentId;
				if (parent === void 0 || snapshot.byId[parent] === void 0) break;
				root = parent;
			}
			const connected = [];
			for (const rawId of Object.keys(snapshot.byId).sort()) {
				const id = rawId;
				const seen = /* @__PURE__ */ new Set();
				let cursor = id;
				while (cursor !== void 0 && !seen.has(cursor)) {
					if (cursor === root) {
						connected.push(`${id}>${snapshot.byId[id]?.parentId ?? ""}`);
						break;
					}
					seen.add(cursor);
					cursor = snapshot.byId[cursor]?.parentId;
				}
			}
			return connected.join("|");
		}
		/** One stable controller is shared by all entries mounted for the same session. */
		var MessageEditController = class {
			sessionId;
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
				status: "idle",
				error: null,
				pending: null,
				timeline: null
			});
			face;
			generation = 0;
			ctx;
			sessions;
			sessionSource;
			eventSource;
			sessionSourceDispose;
			sessionRevision;
			listRevision = "";
			refreshScheduled = false;
			refreshTimer;
			observing = false;
			navigationWaits = /* @__PURE__ */ new Set();
			disposeObservation = void 0;
			inflight = null;
			rerunAfter = false;
			abort = null;
			disposed = false;
			users = 0;
			constructor(ctx, sessionId) {
				this.sessionId = sessionId;
				this.ctx = ctx;
				this.sessions = ctx.sessions;
				this.face = {
					hooks: { messageEdit: this.store },
					acquire: () => {
						this.users += 1;
						if (this.users === 1 && this.disposed) this.revive();
						return () => this.release();
					},
					load: () => {
						this.load();
					},
					edit: (message, text, cascade) => this.mutate({
						action: "edit",
						sessionId: this.sessionId,
						eventSeq: message.eventSeq,
						blockIndex: message.blockIndex,
						text,
						cascade
					}),
					retry: (turn, cascade) => this.mutate({
						action: "retry",
						sessionId: this.sessionId,
						turn,
						cascade
					}),
					reroll: () => this.mutate({
						action: "reroll",
						sessionId: this.sessionId
					}),
					openVersion: (sessionId) => this.openWhenListed(sessionId)
				};
				this.observe();
			}
			observe() {
				this.disposeObservation = this.ctx.effect(() => this.observeDependencies(), `message-edit: observe ${this.sessionId}`);
			}
			release() {
				this.users -= 1;
				if (this.users <= 0) this.dispose();
			}
			/** Tear down regardless of mounted entries; called when the plugin unloads. */
			shutdown() {
				this.users = 0;
				this.dispose();
			}
			/** Tear subscriptions down once no mounted entry uses this controller. */
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.generation += 1;
				if (this.refreshTimer !== void 0) {
					clearTimeout(this.refreshTimer);
					this.refreshTimer = void 0;
					this.refreshScheduled = false;
				}
				this.abort?.abort();
				this.abort = null;
				this.disposeObservation?.();
				this.disposeObservation = void 0;
			}
			/** Re-observe after a transient zero; the retained store keeps old data
			* until the immediate refetch below commits. */
			revive() {
				this.disposed = false;
				this.observe();
				this.refresh();
			}
			/** Bind to replaceable value sources instead of retaining a Session object. */
			observeDependencies() {
				this.observing = true;
				this.listRevision = lineageRevision(this.sessions.list.getSnapshot(), this.sessionId);
				this.bindSessionSource();
				const disposeList = this.sessions.list.subscribe(() => {
					const rebound = this.bindSessionSource();
					const nextRevision = lineageRevision(this.sessions.list.getSnapshot(), this.sessionId);
					if (nextRevision === this.listRevision && !rebound) return;
					this.listRevision = nextRevision;
					this.invalidate();
				});
				return () => {
					this.observing = false;
					this.generation += 1;
					disposeList();
					this.sessionSourceDispose?.();
					this.sessionSourceDispose = void 0;
					this.sessionSource = void 0;
					this.sessionRevision = void 0;
					for (const cancel of [...this.navigationWaits]) cancel();
				};
			}
			bindSessionSource() {
				const binding = this.sessions.binding(this.sessionId);
				const source = binding?.session;
				if (source === this.sessionSource && binding?.eventSource === this.eventSource) return false;
				this.sessionSourceDispose?.();
				this.sessionSource = source;
				this.sessionRevision = source === void 0 ? void 0 : conversationRevision(source.getSnapshot());
				this.eventSource = binding?.eventSource;
				const disposeSession = source?.subscribe(() => {
					if (this.sessionSource !== source) return;
					const revision = conversationRevision(source.getSnapshot());
					if (revision === this.sessionRevision) return;
					this.sessionRevision = revision;
					this.invalidate();
				});
				const disposeEvents = this.eventSource?.subscribe(() => {
					const change = this.eventSource?.getSnapshot().change;
					if (change?.kind === "replace" || change?.kind === "prepend" || change?.kind === "append" && change.entries.some((entry) => entry.type === "event" && entry.event.type === "turn/end")) this.invalidate();
				});
				this.sessionSourceDispose = () => {
					disposeSession?.();
					disposeEvents?.();
				};
				return true;
			}
			invalidate() {
				if (!this.observing || this.store.getSnapshot().status === "idle" || this.refreshScheduled) return;
				this.refreshScheduled = true;
				this.refreshTimer = setTimeout(() => {
					this.refreshTimer = void 0;
					this.refreshScheduled = false;
					if (this.observing && this.store.getSnapshot().status !== "idle") this.refresh();
				}, REFRESH_DELAY_MS);
			}
			/** Invalidation-driven refetch: one in-flight request absorbs the demand
			* and commits a single rerun once it settles. */
			refresh() {
				if (this.disposed) return;
				if (this.inflight !== null) {
					this.rerunAfter = true;
					return;
				}
				this.load();
			}
			/** Refetch the full value-level projection; concurrent callers share one
			* request, and an invalidation during flight schedules exactly one rerun. */
			async load() {
				if (this.disposed) return;
				if (this.inflight !== null) return this.inflight;
				const generation = ++this.generation;
				this.abort?.abort();
				const abort = new AbortController();
				this.abort = abort;
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				const run = this.performLoad(generation, abort);
				this.inflight = run;
				try {
					await run;
				} finally {
					if (this.inflight === run) this.inflight = null;
					if (this.rerunAfter && !this.disposed) {
						this.rerunAfter = false;
						this.load();
					}
				}
			}
			async performLoad(generation, abort) {
				try {
					const timeline = decodeTimeline(await responseValue(await fetch(`${MESSAGE_EDIT_PATH}?sessionId=${encodeURIComponent(this.sessionId)}`, {
						method: "GET",
						headers: { accept: "application/json" },
						cache: "no-store",
						signal: abort.signal
					})));
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "ready";
						state.error = null;
						state.timeline = timeline;
					});
				} catch (error) {
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "error";
						state.error = messageOf(error);
					});
				}
			}
			/** Refresh only controllers whose projection has already been requested. */
			refreshIfLoaded() {
				if (this.disposed || this.store.getSnapshot().status === "idle") return;
				this.refresh();
			}
			async mutate(operation) {
				const current = this.store.getSnapshot();
				if (current.pending !== null || current.status !== "ready") return false;
				this.store.update((state) => {
					state.pending = operation.action;
					state.error = null;
				});
				try {
					const result = decodeOperationResult(await responseValue(await fetch(MESSAGE_EDIT_PATH, {
						method: "POST",
						headers: {
							accept: "application/json",
							"content-type": "application/json"
						},
						body: JSON.stringify(operation)
					})));
					if (this.disposed) return true;
					this.store.update((state) => {
						state.pending = null;
					});
					await this.openWhenListed(result.sessionId);
					return true;
				} catch (error) {
					if (this.disposed) return false;
					this.store.update((state) => {
						state.pending = null;
						state.error = messageOf(error);
					});
					return false;
				}
			}
			/** Session-list publication is the reactive dependency for navigation. */
			openWhenListed(sessionId) {
				if (this.sessions.list.getSnapshot().byId[sessionId] !== void 0) {
					this.ctx.uiWorkspace.openSession(sessionId);
					return Promise.resolve();
				}
				return new Promise((resolve) => {
					let settled = false;
					let dispose = () => {};
					const finish = (open) => {
						if (settled) return;
						settled = true;
						dispose();
						this.navigationWaits.delete(cancel);
						if (open) this.ctx.uiWorkspace.openSession(sessionId);
						resolve();
					};
					const cancel = () => {
						finish(false);
					};
					this.navigationWaits.add(cancel);
					dispose = this.sessions.list.subscribe(() => {
						if (this.sessions.list.getSnapshot().byId[sessionId] === void 0) return;
						finish(true);
					});
					if (this.sessions.list.getSnapshot().byId[sessionId] !== void 0) finish(true);
				});
			}
		};
		//#endregion
		//#region \0dsh-css:src/client/InlineMessageEdit.module.css.mjs
		const css$2 = ".nkgUNq_overlay{z-index:1000;background:var(--dsw-alias-bg-mask,#00000073);justify-content:center;align-items:center;display:flex;position:fixed;inset:0}.nkgUNq_panel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:10px;width:560px;padding:14px 16px}.nkgUNq_title{color:var(--dsw-alias-label-primary);padding:4px 0 10px;font-size:13px}.nkgUNq_input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);width:100%;min-height:160px;color:var(--dsw-alias-label-primary);font:inherit;resize:vertical;border-radius:8px;padding:10px}.nkgUNq_footer{justify-content:flex-end;gap:8px;padding:10px 0 0;display:flex}.nkgUNq_footer button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;padding:6px 14px}.nkgUNq_iconButton{width:20px;height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:4px;justify-content:center;align-items:center;padding:2px;display:inline-flex}.nkgUNq_iconButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-hover)}.nkgUNq_picker{flex-direction:column;gap:6px;padding:4px 0 12px;display:flex}.nkgUNq_pickerItem{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;border-radius:6px;padding:8px 10px;font-size:12px}.nkgUNq_pickerItem:hover{background:var(--dsw-alias-bg-module-platform)}.nkgUNq_pickerItemActive{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;align-self:flex-end;padding:6px 14px}";
		const tagId$2 = "dsh-message-edit/InlineMessageEdit.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var InlineMessageEdit_module_css_default = {
			"footer": "nkgUNq_footer",
			"iconButton": "nkgUNq_iconButton",
			"input": "nkgUNq_input",
			"overlay": "nkgUNq_overlay",
			"panel": "nkgUNq_panel",
			"picker": "nkgUNq_picker",
			"pickerItem": "nkgUNq_pickerItem",
			"pickerItemActive": "nkgUNq_pickerItemActive",
			"title": "nkgUNq_title"
		};
		//#endregion
		//#region src/client/InlineMessageEdit.tsx
		/**
		* Message-row edit affordance: injects retry + edit icon buttons into each
		* settled message's icon-actions row (the official MessageIconActions has no
		* plugin slot, so injection rides a MutationObserver over action rows).
		* Icons are the official outline-16 SVGs inlined to avoid bundling the
		* primitives package.
		*/
		const BLOCK_TITLE = {
			user: "编辑用户消息",
			"assistant.reasoning": "编辑助手思考",
			"assistant.response": "编辑助手回复"
		};
		const STYLE = {
			overlay: InlineMessageEdit_module_css_default["overlay"] ?? "",
			panel: InlineMessageEdit_module_css_default["panel"] ?? "",
			title: InlineMessageEdit_module_css_default["title"] ?? "",
			input: InlineMessageEdit_module_css_default["input"] ?? "",
			footer: InlineMessageEdit_module_css_default["footer"] ?? "",
			iconButton: InlineMessageEdit_module_css_default["iconButton"] ?? "",
			picker: InlineMessageEdit_module_css_default["picker"] ?? "",
			pickerItem: InlineMessageEdit_module_css_default["pickerItem"] ?? "",
			pickerItemActive: InlineMessageEdit_module_css_default["pickerItemActive"] ?? ""
		};
		/** Official ic_ds_refresh_outline_16 path (dsh-client-ui-primitives). */
		const REFRESH_PATH = "M7.92136 0.349152C10.3744 0.349234 12.5564 1.5052 13.9557 3.29894L15.1281 2.12759C15.3303 1.92546 15.6767 2.06943 15.6767 2.35538V5.53923C15.6766 5.71626 15.5329 5.85976 15.3559 5.86002H12.171C11.8854 5.8597 11.7426 5.51465 11.9443 5.31249L12.9641 4.29056C11.8237 2.74305 9.98908 1.74106 7.92136 1.74097C4.46436 1.74097 1.66233 4.543 1.66233 8C1.66233 11.457 4.46436 14.259 7.92136 14.259C11.3782 14.2589 14.1804 11.4569 14.1804 8H15.5722C15.5722 12.2251 12.1465 15.6507 7.92136 15.6508C3.69614 15.6508 0.270508 12.2252 0.270508 8C0.270508 3.77478 3.69614 0.349152 7.92136 0.349152Z";
		/** Official ic_ds_edit_outline_16 path (dsh-client-ui-primitives). */
		const EDIT_PATH = "M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z";
		function svgIcon(path) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
			svg.setAttribute("viewBox", "0 0 16 16");
			svg.setAttribute("fill", "none");
			const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
			p.setAttribute("d", path);
			p.setAttribute("fill", "currentColor");
			svg.appendChild(p);
			return svg;
		}
		function blockTitle(kind) {
			return BLOCK_TITLE[kind] ?? "编辑消息";
		}
		/** Mount one editor DOM effect and return its exact inverse. */
		function mountEditor(block, edit, close) {
			const overlay = document.createElement("div");
			overlay.className = STYLE.overlay;
			const panel = document.createElement("div");
			panel.className = STYLE.panel;
			const title = document.createElement("div");
			title.className = STYLE.title;
			title.textContent = blockTitle(block.kind);
			const input = document.createElement("textarea");
			input.className = STYLE.input;
			input.value = block.text;
			const footer = document.createElement("div");
			footer.className = STYLE.footer;
			const save = document.createElement("button");
			save.textContent = "保存";
			const cancel = document.createElement("button");
			cancel.textContent = "取消";
			footer.append(save, cancel);
			panel.append(title, input, footer);
			overlay.appendChild(panel);
			document.body.appendChild(overlay);
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			let mounted = true;
			let saving = false;
			const saveEdit = () => {
				if (saving) return;
				saving = true;
				save.disabled = true;
				edit(block, input.value, "truncate").then((applied) => {
					if (!mounted) return;
					if (applied) {
						close();
						return;
					}
					saving = false;
					save.disabled = false;
				});
			};
			const cancelEdit = () => {
				close();
			};
			const dismiss = (event) => {
				if (event.target === overlay) close();
			};
			save.addEventListener("click", saveEdit);
			cancel.addEventListener("click", cancelEdit);
			overlay.addEventListener("click", dismiss);
			return () => {
				mounted = false;
				save.removeEventListener("click", saveEdit);
				cancel.removeEventListener("click", cancelEdit);
				overlay.removeEventListener("click", dismiss);
				overlay.remove();
			};
		}
		/** Mount one block-picker DOM effect and return its exact inverse. */
		function mountPicker(blocks, select, close) {
			const overlay = document.createElement("div");
			overlay.className = STYLE.overlay;
			const panel = document.createElement("div");
			panel.className = STYLE.panel;
			const title = document.createElement("div");
			title.className = STYLE.title;
			title.textContent = blocks.some((block) => block.kind === "user") ? "编辑消息" : "编辑助手消息";
			const picker = document.createElement("div");
			picker.className = STYLE.picker;
			const itemListeners = [];
			for (const block of blocks) {
				const item = document.createElement("button");
				item.className = STYLE.pickerItem;
				item.textContent = `${blockTitle(block.kind)}：${block.text.slice(0, 24)}${block.text.length > 24 ? "…" : ""}`;
				const listener = () => {
					select(block);
				};
				item.addEventListener("click", listener);
				itemListeners.push({
					item,
					listener
				});
				picker.appendChild(item);
			}
			const cancel = document.createElement("button");
			cancel.textContent = "取消";
			cancel.className = STYLE.pickerItemActive;
			const cancelPicker = () => {
				close();
			};
			cancel.addEventListener("click", cancelPicker);
			panel.append(title, picker, cancel);
			overlay.appendChild(panel);
			document.body.appendChild(overlay);
			return () => {
				for (const { item, listener } of itemListeners) item.removeEventListener("click", listener);
				cancel.removeEventListener("click", cancelPicker);
				overlay.remove();
			};
		}
		/** Compose every overlay with a single idempotent active inverse. */
		function createOverlayHost(edit) {
			let active;
			const mount = (effect) => {
				active?.();
				let cleanup = () => {};
				let mounted = true;
				const close = () => {
					if (!mounted) return;
					mounted = false;
					cleanup();
					if (active === close) active = void 0;
				};
				active = close;
				try {
					cleanup = effect(close);
				} catch (error) {
					active = void 0;
					mounted = false;
					throw error;
				}
			};
			const editBlock = (block) => {
				mount((close) => mountEditor(block, edit, close));
			};
			const chooseBlock = (blocks) => {
				mount((close) => mountPicker(blocks, (block) => {
					close();
					editBlock(block);
				}, close));
			};
			return {
				editBlock,
				chooseBlock,
				dispose: () => {
					active?.();
				}
			};
		}
		/** Own panel root for this header; never search a sibling Chat pane. */
		function conversationScope(anchor) {
			const root = anchor.closest("[data-phase]") ?? anchor.closest("header")?.parentElement ?? void 0;
			return root?.querySelector("[data-chat-flow]") === null ? void 0 : root;
		}
		/** Inject retry + edit icon buttons into each message action row. */
		function InlineMessageEdit({ messages, edit, retry }) {
			const anchor = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const cleanups = [];
				const overlays = createOverlayHost(edit);
				let observer;
				let alive = true;
				let frame;
				let scheduled = false;
				const sync = () => {
					const scope = anchor.current === null ? void 0 : conversationScope(anchor.current);
					if (scope === void 0) return;
					const actionRows = Array.from(scope.querySelectorAll("[data-chat-flow-key] [class*=\"actions\"]"));
					const claimedEvents = /* @__PURE__ */ new Set();
					for (const row of actionRows) {
						const marker = row;
						if (marker.__messageEditInjected === true) {
							if (marker.__messageEditEventSeq !== void 0) claimedEvents.add(marker.__messageEditEventSeq);
							continue;
						}
						const node = row.closest("[data-chat-flow-key]");
						const key = node?.dataset["chatFlowKey"];
						const kind = node?.dataset["chatFlowKind"];
						let candidates = messages.filter((message) => message.chatNodeKey === key);
						if (kind === "turn-tail") {
							const turn = Number(node?.dataset["chatTurn"]);
							const assistant = messages.filter((message) => message.turn === turn && message.kind !== "user");
							const lastSeq = Math.max(...assistant.map((message) => message.eventSeq));
							candidates = assistant.filter((message) => message.eventSeq === lastSeq);
						}
						const eventSeq = [...new Set(candidates.map((message) => message.eventSeq))].find((candidate) => !claimedEvents.has(candidate));
						if (eventSeq === void 0) continue;
						const blocks = messages.filter((message) => message.eventSeq === eventSeq);
						if (blocks.length === 0) continue;
						const previousMarker = marker.__messageEditInjected;
						const previousEventSeq = marker.__messageEditEventSeq;
						marker.__messageEditInjected = true;
						marker.__messageEditEventSeq = eventSeq;
						claimedEvents.add(eventSeq);
						const editButton = document.createElement("button");
						editButton.className = STYLE.iconButton;
						editButton.setAttribute("aria-label", "编辑消息");
						editButton.title = "编辑消息";
						editButton.appendChild(svgIcon(EDIT_PATH));
						const editMessage = () => {
							if (blocks.length === 1 && blocks[0] !== void 0) overlays.editBlock(blocks[0]);
							else overlays.chooseBlock(blocks);
						};
						editButton.addEventListener("click", editMessage);
						const retryButton = document.createElement("button");
						retryButton.className = STYLE.iconButton;
						retryButton.setAttribute("aria-label", "重试此回合");
						retryButton.title = "重试此回合";
						retryButton.appendChild(svgIcon(REFRESH_PATH));
						const turn = blocks[0]?.turn;
						const retryTurn = () => {
							if (turn !== void 0) retry(turn, "truncate");
						};
						retryButton.addEventListener("click", retryTurn);
						const lastOfficial = Array.from(row.querySelectorAll("button")).filter((button) => button !== editButton && button !== retryButton).at(-1);
						if (lastOfficial !== void 0) {
							lastOfficial.insertAdjacentElement("afterend", retryButton);
							lastOfficial.insertAdjacentElement("afterend", editButton);
						} else {
							row.appendChild(editButton);
							row.appendChild(retryButton);
						}
						cleanups.push(() => {
							editButton.removeEventListener("click", editMessage);
							retryButton.removeEventListener("click", retryTurn);
							editButton.remove();
							retryButton.remove();
							if (previousMarker === void 0) delete marker.__messageEditInjected;
							else marker.__messageEditInjected = previousMarker;
							if (previousEventSeq === void 0) delete marker.__messageEditEventSeq;
							else marker.__messageEditEventSeq = previousEventSeq;
						});
					}
				};
				sync();
				observer = new MutationObserver(() => {
					if (!alive || scheduled) return;
					scheduled = true;
					frame = requestAnimationFrame(() => {
						frame = void 0;
						scheduled = false;
						if (alive) sync();
					});
				});
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					alive = false;
					if (frame !== void 0) cancelAnimationFrame(frame);
					observer?.disconnect();
					overlays.dispose();
					for (const cleanup of cleanups.reverse()) cleanup();
				};
			}, [
				messages,
				edit,
				retry
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref: anchor,
				hidden: true,
				"data-message-edit-anchor": ""
			});
		}
		//#endregion
		//#region \0dsh-css:src/client/MessageEditHeader.module.css.mjs
		const css$1 = ".aqxRVa_root{align-items:center;gap:4px;display:inline-flex}.aqxRVa_iconButton,.aqxRVa_rerollButton{box-sizing:border-box;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0}.aqxRVa_iconButton{border-radius:50%;justify-content:center;align-items:center;width:28px;height:28px;font-size:16px;line-height:20px;display:inline-flex}.aqxRVa_rerollButton{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;height:28px;padding:0 10px;font-size:12px;line-height:18px}.aqxRVa_iconButton:hover:not(:disabled),.aqxRVa_rerollButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.aqxRVa_iconButton:focus-visible,.aqxRVa_rerollButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.aqxRVa_iconButton:disabled,.aqxRVa_rerollButton:disabled{cursor:default;opacity:.4}.aqxRVa_counter{min-width:108px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:11px;line-height:18px}@media (width<=760px){.aqxRVa_counter{display:none}}";
		const tagId$1 = "dsh-message-edit/MessageEditHeader.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var MessageEditHeader_module_css_default = {
			"counter": "aqxRVa_counter",
			"iconButton": "aqxRVa_iconButton",
			"rerollButton": "aqxRVa_rerollButton",
			"root": "aqxRVa_root"
		};
		//#endregion
		//#region src/client/MessageEditHeader.tsx
		/** Header contribution shared with the Timeline controller. */
		function MessageEditHeader({ useMessageEdit, acquire, load, openVersion, reroll, edit, retry }) {
			const state = useMessageEdit((value) => value);
			(0, react.useEffect)(() => {
				const release = acquire();
				load();
				return release;
			}, [acquire, load]);
			const timeline = state.timeline;
			const versions = state.timeline?.versions ?? [];
			const undoSessionId = timeline?.undoStack[0];
			const redoSessionId = timeline?.redoSessionIds.at(-1);
			const effectDepth = timeline?.undoStack.length ?? 0;
			const busy = state.pending !== null || state.status !== "ready";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InlineMessageEdit, {
				messages: state.status === "ready" && state.pending === null ? timeline?.messages ?? [] : [],
				edit,
				retry
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MessageEditHeader_module_css_default["root"],
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MessageEditHeader_module_css_default["iconButton"],
						"aria-label": "撤销当前版本效果",
						title: "撤销当前效果，保留更早效果",
						disabled: undoSessionId === void 0 || busy,
						onClick: () => {
							if (undoSessionId !== void 0) openVersion(undoSessionId);
						},
						children: "←"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: MessageEditHeader_module_css_default["counter"],
						children: versions.length === 0 ? "效果 —" : `效果 ${String(effectDepth)} 层 · ${String(versions.length)} 版`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MessageEditHeader_module_css_default["iconButton"],
						"aria-label": "重施加下一版本效果",
						title: timeline !== null && timeline.redoSessionIds.length > 1 ? `重施加最新效果（另有 ${String(timeline.redoSessionIds.length - 1)} 个分支）` : "重施加下一效果",
						disabled: redoSessionId === void 0 || busy,
						onClick: () => {
							if (redoSessionId !== void 0) openVersion(redoSessionId);
						},
						children: "→"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MessageEditHeader_module_css_default["rerollButton"],
						disabled: busy || state.timeline === null,
						onClick: () => {
							reroll();
						},
						children: state.pending === "reroll" ? "正在重生成…" : "重生成"
					})
				]
			})] });
		}
		//#endregion
		//#region \0dsh-css:src/client/MessageEditTimelineView.module.css.mjs
		const css = ".ccVB3q_root{box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);padding:24px;overflow:auto}.ccVB3q_pageHeader{justify-content:space-between;align-items:flex-start;gap:20px;max-width:1480px;margin:0 auto 16px;display:flex}.ccVB3q_title,.ccVB3q_intro,.ccVB3q_subtitle,.ccVB3q_notice,.ccVB3q_error,.ccVB3q_empty,.ccVB3q_turnTitle,.ccVB3q_turnPreview,.ccVB3q_messageText{margin:0}.ccVB3q_title{font-size:22px;font-weight:600;line-height:30px}.ccVB3q_intro{max-width:700px;color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:13px;line-height:20px}.ccVB3q_headerActions{flex:none;align-items:flex-end;gap:8px;display:flex}.ccVB3q_cascadeField{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;font-size:11px;line-height:16px;display:flex}.ccVB3q_select,.ccVB3q_textarea,.ccVB3q_primaryButton,.ccVB3q_secondaryButton,.ccVB3q_textButton,.ccVB3q_versionButton{box-sizing:border-box;font:inherit}.ccVB3q_select,.ccVB3q_textarea{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-radius:8px}.ccVB3q_select{height:34px;padding:0 30px 0 9px;font-size:12px}.ccVB3q_primaryButton,.ccVB3q_secondaryButton,.ccVB3q_textButton,.ccVB3q_versionButton{cursor:pointer;border:0}.ccVB3q_primaryButton,.ccVB3q_secondaryButton{border-radius:17px;justify-content:center;align-items:center;min-height:34px;padding:0 13px;font-size:12px;line-height:18px;display:inline-flex}.ccVB3q_primaryButton{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill)}.ccVB3q_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.ccVB3q_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.ccVB3q_secondaryButton:hover:not(:disabled),.ccVB3q_textButton:hover:not(:disabled),.ccVB3q_versionButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.ccVB3q_primaryButton:disabled,.ccVB3q_secondaryButton:disabled,.ccVB3q_textButton:disabled,.ccVB3q_versionButton:disabled,.ccVB3q_select:disabled{cursor:default;opacity:.45}.ccVB3q_primaryButton:focus-visible,.ccVB3q_secondaryButton:focus-visible,.ccVB3q_textButton:focus-visible,.ccVB3q_versionButton:focus-visible,.ccVB3q_select:focus-visible,.ccVB3q_textarea:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.ccVB3q_notice,.ccVB3q_error{max-width:1480px;margin:0 auto 10px;font-size:12px;line-height:18px}.ccVB3q_notice{color:var(--dsw-alias-state-warn-label)}.ccVB3q_error{color:var(--dsw-alias-state-error-primary)}.ccVB3q_status{box-sizing:border-box;width:100%;height:100%;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);flex-direction:column;align-items:flex-start;gap:12px;padding:24px;display:flex}.ccVB3q_status .ccVB3q_error{margin:0}.ccVB3q_columns{grid-template-columns:minmax(280px,.72fr) minmax(520px,1.75fr);align-items:start;gap:18px;max-width:1480px;margin:0 auto;display:grid}.ccVB3q_versionsPanel,.ccVB3q_turnsPanel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;min-width:0;padding:16px}.ccVB3q_versionsPanel{position:sticky;top:0}.ccVB3q_sectionHeading{justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;display:flex}.ccVB3q_effectControls{background:var(--dsw-alias-bg-module-platform);border-radius:9px;flex-direction:column;gap:8px;margin-bottom:12px;padding:10px;display:flex}.ccVB3q_effectDepth{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}.ccVB3q_effectButtons{flex-wrap:wrap;gap:6px;display:flex}.ccVB3q_effectButtons .ccVB3q_secondaryButton{min-height:28px;padding:0 10px;font-size:11px}.ccVB3q_subtitle{font-size:16px;font-weight:500;line-height:24px}.ccVB3q_count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.ccVB3q_versionList,.ccVB3q_turnList{margin:0;padding:0;list-style:none}.ccVB3q_versionList{flex-direction:column;gap:4px;display:flex}.ccVB3q_versionItem{--message-edit-depth:0;padding-left:calc(var(--message-edit-depth) * 14px);position:relative}.ccVB3q_versionButton{width:100%;min-width:0;color:var(--dsw-alias-label-secondary);text-align:left;background:0 0;border-radius:9px;align-items:flex-start;gap:9px;padding:9px;display:flex;position:relative}.ccVB3q_versionButton[data-current]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);opacity:1}.ccVB3q_versionButton:not([data-current]) .ccVB3q_pathBadge{opacity:.8}.ccVB3q_versionLine{background:var(--dsw-alias-border-l2);width:1px;position:absolute;top:0;bottom:0;left:14px}.ccVB3q_versionDot{z-index:1;border:2px solid var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-label-tertiary);border-radius:50%;flex:none;width:7px;height:7px;margin-top:6px}.ccVB3q_versionButton[data-current] .ccVB3q_versionDot{border-color:var(--dsw-alias-bg-module-platform);background:var(--dsw-alias-brand-primary)}.ccVB3q_versionMain{flex-direction:column;flex:1;min-width:0;display:flex}.ccVB3q_versionTitle{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}.ccVB3q_versionMeta{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;overflow:hidden}.ccVB3q_versionDiff{color:var(--dsw-alias-label-tertiary);flex-direction:column;gap:2px;margin-top:5px;font-size:10px;line-height:15px;display:flex}.ccVB3q_versionDiff span{-webkit-line-clamp:2;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}.ccVB3q_currentBadge,.ccVB3q_pathBadge,.ccVB3q_kindBadge{border-radius:9px;flex:none;padding:1px 6px;font-size:10px;line-height:17px}.ccVB3q_currentBadge{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}.ccVB3q_pathBadge{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}.ccVB3q_turnList{flex-direction:column;gap:14px;display:flex}.ccVB3q_turnSection{border:1px solid var(--dsw-alias-border-l2);border-radius:11px;padding:13px}.ccVB3q_turnHeader,.ccVB3q_messageHeader,.ccVB3q_editorActions{justify-content:space-between;align-items:center;gap:10px;display:flex}.ccVB3q_turnHeader{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:flex-start;padding-bottom:11px}.ccVB3q_turnTitle{font-size:14px;font-weight:500;line-height:22px}.ccVB3q_turnPreview{max-width:700px;color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;white-space:pre-wrap;-webkit-box-orient:vertical;font-size:11px;line-height:17px;display:-webkit-box;overflow:hidden}.ccVB3q_messageList{flex-direction:column;gap:8px;margin-top:10px;display:flex}.ccVB3q_messageCard{background:var(--dsw-alias-bg-module-platform);border-radius:9px;padding:10px}.ccVB3q_messageHeader{justify-content:flex-start}.ccVB3q_kindBadge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}.ccVB3q_kindBadge[data-kind=assistant\\.reasoning]{color:var(--dsw-alias-label-tertiary)}.ccVB3q_messageTime{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:17px}.ccVB3q_textButton{color:var(--dsw-alias-label-secondary);background:0 0;border-radius:12px;margin-left:auto;padding:3px 8px;font-size:11px;line-height:17px}.ccVB3q_messageText{max-height:220px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7px;font-family:inherit;font-size:12px;line-height:19px;overflow:auto}.ccVB3q_editor{margin-top:8px}.ccVB3q_textarea{resize:vertical;width:100%;min-height:120px;padding:9px;font-size:12px;line-height:19px}.ccVB3q_editorActions{margin-top:8px}.ccVB3q_editorHint{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}.ccVB3q_empty{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:18px;font-size:13px;line-height:20px}@media (width<=1000px){.ccVB3q_columns{grid-template-columns:1fr}.ccVB3q_versionsPanel{position:static}}@media (width<=680px){.ccVB3q_root{padding:16px}.ccVB3q_pageHeader,.ccVB3q_headerActions,.ccVB3q_turnHeader,.ccVB3q_editorActions{flex-direction:column;align-items:stretch}.ccVB3q_headerActions,.ccVB3q_primaryButton,.ccVB3q_secondaryButton{width:100%}}";
		const tagId = "dsh-message-edit/MessageEditTimelineView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var MessageEditTimelineView_module_css_default = {
			"cascadeField": "ccVB3q_cascadeField",
			"columns": "ccVB3q_columns",
			"count": "ccVB3q_count",
			"currentBadge": "ccVB3q_currentBadge",
			"editor": "ccVB3q_editor",
			"editorActions": "ccVB3q_editorActions",
			"editorHint": "ccVB3q_editorHint",
			"effectButtons": "ccVB3q_effectButtons",
			"effectControls": "ccVB3q_effectControls",
			"effectDepth": "ccVB3q_effectDepth",
			"empty": "ccVB3q_empty",
			"error": "ccVB3q_error",
			"headerActions": "ccVB3q_headerActions",
			"intro": "ccVB3q_intro",
			"kindBadge": "ccVB3q_kindBadge",
			"messageCard": "ccVB3q_messageCard",
			"messageHeader": "ccVB3q_messageHeader",
			"messageList": "ccVB3q_messageList",
			"messageText": "ccVB3q_messageText",
			"messageTime": "ccVB3q_messageTime",
			"notice": "ccVB3q_notice",
			"pageHeader": "ccVB3q_pageHeader",
			"pathBadge": "ccVB3q_pathBadge",
			"primaryButton": "ccVB3q_primaryButton",
			"root": "ccVB3q_root",
			"secondaryButton": "ccVB3q_secondaryButton",
			"sectionHeading": "ccVB3q_sectionHeading",
			"select": "ccVB3q_select",
			"status": "ccVB3q_status",
			"subtitle": "ccVB3q_subtitle",
			"textarea": "ccVB3q_textarea",
			"textButton": "ccVB3q_textButton",
			"title": "ccVB3q_title",
			"turnHeader": "ccVB3q_turnHeader",
			"turnList": "ccVB3q_turnList",
			"turnPreview": "ccVB3q_turnPreview",
			"turnSection": "ccVB3q_turnSection",
			"turnsPanel": "ccVB3q_turnsPanel",
			"turnTitle": "ccVB3q_turnTitle",
			"versionButton": "ccVB3q_versionButton",
			"versionDiff": "ccVB3q_versionDiff",
			"versionDot": "ccVB3q_versionDot",
			"versionItem": "ccVB3q_versionItem",
			"versionLine": "ccVB3q_versionLine",
			"versionList": "ccVB3q_versionList",
			"versionMain": "ccVB3q_versionMain",
			"versionMeta": "ccVB3q_versionMeta",
			"versionsPanel": "ccVB3q_versionsPanel",
			"versionTitle": "ccVB3q_versionTitle"
		};
		//#endregion
		//#region src/client/MessageEditTimelineView.tsx
		/** Timeline tab: durable version tree plus turn/block edit and retry controls. */
		const BLOCK_LABEL = {
			user: "用户消息",
			"assistant.reasoning": "助手思考",
			"assistant.response": "助手回复"
		};
		const OPERATION_LABEL = {
			edit: "编辑",
			reroll: "重生成",
			retry: "重试"
		};
		function timeLabel(value) {
			return new Date(value).toLocaleString("zh-CN", {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			});
		}
		function turnSections(turns, messages) {
			return turns.map((retry) => ({
				retry,
				messages: messages.filter((message) => message.turn === retry.turn)
			}));
		}
		function VersionRow({ version, disabled, onOpen }) {
			const depthStyle = { "--message-edit-depth": String(version.depth) };
			const operation = version.operation === void 0 ? version.parentSessionId === void 0 ? "原始版本" : "外部分支" : OPERATION_LABEL[version.operation];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
				className: MessageEditTimelineView_module_css_default["versionItem"],
				style: depthStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: MessageEditTimelineView_module_css_default["versionButton"],
					"data-current": version.current || void 0,
					disabled: version.current || disabled,
					onClick: () => {
						onOpen(version.sessionId);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["versionLine"],
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["versionDot"],
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: MessageEditTimelineView_module_css_default["versionMain"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MessageEditTimelineView_module_css_default["versionTitle"],
									children: [operation, version.targetTurn === void 0 ? null : ` · 回合 ${String(version.targetTurn)}`]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MessageEditTimelineView_module_css_default["versionMeta"],
									children: [
										timeLabel(version.createdAt),
										" · ",
										version.sessionId.slice(0, 12)
									]
								}),
								version.before === void 0 && version.after === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MessageEditTimelineView_module_css_default["versionDiff"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["原：", version.before || "（空）"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["新：", version.after || "（空）"] })]
								})
							]
						}),
						version.current ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["currentBadge"],
							children: "当前"
						}) : version.onCurrentEffectPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["pathBadge"],
							children: "链上"
						}) : null
					]
				})
			});
		}
		function MessageCard({ message, editing, disabled, cascade, onBeginEdit, onCancelEdit, onTextChange, onApplyEdit }) {
			const active = editing?.message.key === message.key;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: MessageEditTimelineView_module_css_default["messageCard"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MessageEditTimelineView_module_css_default["messageHeader"],
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["kindBadge"],
							"data-kind": message.kind,
							children: BLOCK_LABEL[message.kind]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["messageTime"],
							children: timeLabel(message.time)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageEditTimelineView_module_css_default["textButton"],
							disabled,
							onClick: () => {
								active ? onCancelEdit() : onBeginEdit(message);
							},
							children: active ? "取消" : "编辑"
						})
					]
				}), active && editing !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MessageEditTimelineView_module_css_default["editor"],
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: MessageEditTimelineView_module_css_default["textarea"],
						value: editing.text,
						rows: 6,
						autoFocus: true,
						onChange: (event) => {
							onTextChange(event.currentTarget.value);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MessageEditTimelineView_module_css_default["editorActions"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["editorHint"],
							children: "将从该回合之前分支，原版本保持不变。"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageEditTimelineView_module_css_default["primaryButton"],
							disabled,
							onClick: () => {
								onApplyEdit(message, editing.text, cascade);
							},
							children: "应用并重生成"
						})]
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: MessageEditTimelineView_module_css_default["messageText"],
					children: message.text || "（空内容）"
				})]
			});
		}
		/** Conversation-view entry point. */
		function MessageEditTimelineView({ useMessageEdit, acquire, load, edit, retry, reroll, openVersion }) {
			const state = useMessageEdit((value) => value);
			const [cascade, setCascade] = (0, react.useState)("truncate");
			const [editing, setEditing] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const release = acquire();
				load();
				return release;
			}, [acquire, load]);
			const timeline = state.timeline;
			const sections = (0, react.useMemo)(() => timeline === null ? [] : turnSections(timeline.retryableTurns, timeline.messages), [timeline]);
			const busy = state.pending !== null || state.status !== "ready";
			(0, react.useEffect)(() => {
				setEditing((current) => {
					if (current === null || timeline === null) return current;
					return timeline.messages.some((message) => message.key === current.message.key) ? current : null;
				});
			}, [timeline]);
			if (timeline === null && (state.status === "idle" || state.status === "loading")) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: MessageEditTimelineView_module_css_default["status"],
				children: "正在载入消息时间线…"
			});
			if (timeline === null && state.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MessageEditTimelineView_module_css_default["status"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: MessageEditTimelineView_module_css_default["error"],
					children: state.error
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: MessageEditTimelineView_module_css_default["secondaryButton"],
					onClick: load,
					children: "重新载入"
				})]
			});
			if (timeline === null) return null;
			const applyEdit = (message, text, policy) => {
				setEditing(null);
				edit(message, text, policy);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MessageEditTimelineView_module_css_default["root"],
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: MessageEditTimelineView_module_css_default["pageHeader"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							className: MessageEditTimelineView_module_css_default["title"],
							children: "消息编辑与重生成"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: MessageEditTimelineView_module_css_default["intro"],
							children: "每次修改都会与其恢复版本成对记录；回合及其完整工具链作为一个整体重新计算。"
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MessageEditTimelineView_module_css_default["headerActions"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: MessageEditTimelineView_module_css_default["cascadeField"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "后续策略" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: MessageEditTimelineView_module_css_default["select"],
									value: cascade,
									disabled: busy,
									onChange: (event) => {
										setCascade(event.currentTarget.value);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "truncate",
										children: "截断后续（默认）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "preserve",
										children: "保留输入并重生成后续"
									})]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: MessageEditTimelineView_module_css_default["primaryButton"],
								disabled: busy,
								onClick: () => {
									reroll();
								},
								children: state.pending === "reroll" ? "正在重生成…" : "重生成最后回复"
							})]
						})]
					}),
					state.error === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MessageEditTimelineView_module_css_default["error"],
						children: state.error
					}),
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MessageEditTimelineView_module_css_default["notice"],
						children: "正在刷新时间线…"
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MessageEditTimelineView_module_css_default["columns"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: MessageEditTimelineView_module_css_default["versionsPanel"],
							"aria-label": "版本时间线",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MessageEditTimelineView_module_css_default["sectionHeading"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
										className: MessageEditTimelineView_module_css_default["subtitle"],
										children: "版本时间线"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: MessageEditTimelineView_module_css_default["count"],
										children: String(timeline.versions.length)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MessageEditTimelineView_module_css_default["effectControls"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: MessageEditTimelineView_module_css_default["effectDepth"],
										children: [
											"当前效果链 ",
											String(timeline.undoStack.length),
											" 层"
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: MessageEditTimelineView_module_css_default["effectButtons"],
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: MessageEditTimelineView_module_css_default["secondaryButton"],
											disabled: busy || timeline.undoStack[0] === void 0,
											onClick: () => {
												const target = timeline.undoStack[0];
												if (target !== void 0) openVersion(target);
											},
											children: "撤销当前效果"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: MessageEditTimelineView_module_css_default["secondaryButton"],
											disabled: busy || timeline.redoSessionIds.length === 0,
											onClick: () => {
												const target = timeline.redoSessionIds.at(-1);
												if (target !== void 0) openVersion(target);
											},
											children: timeline.redoSessionIds.length > 1 ? `重施加最新分支（${String(timeline.redoSessionIds.length)}）` : "重施加下一效果"
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
									className: MessageEditTimelineView_module_css_default["versionList"],
									children: timeline.versions.map((version) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VersionRow, {
										version,
										disabled: busy,
										onOpen: (sessionId) => {
											openVersion(sessionId);
										}
									}, version.sessionId))
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
							className: MessageEditTimelineView_module_css_default["turnsPanel"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MessageEditTimelineView_module_css_default["sectionHeading"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: MessageEditTimelineView_module_css_default["subtitle"],
									children: "已落定消息"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MessageEditTimelineView_module_css_default["count"],
									children: String(timeline.messages.length)
								})]
							}), sections.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MessageEditTimelineView_module_css_default["empty"],
								children: "当前会话还没有可编辑的已落定回合。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
								className: MessageEditTimelineView_module_css_default["turnList"],
								children: sections.map((section) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									className: MessageEditTimelineView_module_css_default["turnSection"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: MessageEditTimelineView_module_css_default["turnHeader"],
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
											className: MessageEditTimelineView_module_css_default["turnTitle"],
											children: ["回合 ", String(section.retry.turn)]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: MessageEditTimelineView_module_css_default["turnPreview"],
											children: section.retry.preview || "（空用户输入）"
										})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: MessageEditTimelineView_module_css_default["secondaryButton"],
											disabled: busy,
											onClick: () => {
												retry(section.retry.turn, cascade);
											},
											children: state.pending === "retry" ? "正在重试…" : "重试此回合"
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: MessageEditTimelineView_module_css_default["messageList"],
										children: section.messages.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageCard, {
											message,
											editing,
											disabled: busy,
											cascade,
											onBeginEdit: (value) => {
												setEditing({
													message: value,
													text: value.text
												});
											},
											onCancelEdit: () => {
												setEditing(null);
											},
											onTextChange: (text) => {
												setEditing((current) => current === null ? null : {
													...current,
													text
												});
											},
											onApplyEdit: applyEdit
										}, message.key))
									})]
								}, section.retry.turn))
							})]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services: slot declaration, Session Retain access, and navigation. */
		const inject = [
			"slots",
			"sessions",
			"uiWorkspace"
		];
		/** Register both UI contributions over one per-session controller identity. */
		function apply(ctx) {
			const controllers = /* @__PURE__ */ new Map();
			const controllerFor = (sessionId) => {
				let controller = controllers.get(sessionId);
				if (controller === void 0) {
					controller = new MessageEditController(ctx, sessionId);
					controllers.set(sessionId, controller);
				}
				return controller;
			};
			ctx.effect(() => () => {
				for (const controller of controllers.values()) controller.shutdown();
				controllers.clear();
			}, "message-edit: per-session controllers");
			ctx.on("connection/reset", () => {
				for (const controller of controllers.values()) controller.refreshIfLoaded();
			});
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "message-edit-timeline",
				order: 15,
				label: "Timeline",
				inject: (sessionId) => controllerFor(sessionId).face
			}, MessageEditTimelineView));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "message-edit-controls",
				order: 15,
				inject: (sessionId) => controllerFor(sessionId).face
			}, MessageEditHeader));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map