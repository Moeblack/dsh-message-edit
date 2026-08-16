window.__ModuleLoader__.load({
	id: "dsh-message-edit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared.ts
		/** Same-origin endpoint owned by the Message Edit host plugin. */
		const MESSAGE_EDIT_PATH = "/message-edit";
		//#endregion
		//#region src/client/controller.ts
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
				...row["userEventSeq"] === void 0 ? {} : { userEventSeq: numberValue(row["userEventSeq"], "回合 userEventSeq") },
				preview: stringValue(row["preview"], "回合 preview"),
				time: numberValue(row["time"], "回合 time"),
				retryable: booleanValue(row["retryable"], "回合 retryable")
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
		function emptyDrafts() {
			return {
				textByKey: {},
				deletedEventSeqs: []
			};
		}
		function pruneDrafts(drafts, timeline) {
			const messagesByKey = new Map(timeline.messages.map((message) => [message.key, message]));
			const textByKey = Object.fromEntries(Object.entries(drafts.textByKey).filter(([key, text]) => messagesByKey.get(key)?.text !== void 0 && messagesByKey.get(key)?.text !== text));
			const messageEventSeqs = new Set(timeline.messages.map((message) => message.eventSeq));
			return {
				textByKey,
				deletedEventSeqs: drafts.deletedEventSeqs.filter((eventSeq) => messageEventSeqs.has(eventSeq))
			};
		}
		async function responseValue(response) {
			const value = await response.json();
			if (response.ok) return value;
			const error = objectValue(value, "错误响应")["error"];
			throw new Error(typeof error === "string" ? error : `请求失败：HTTP ${String(response.status)}`);
		}
		function conversationRevision(snapshot) {
			const turnEnds = [...snapshot.turnEnds.entries()].map(([turn, seq]) => `${String(turn)}:${String(seq)}`).join(",");
			return [
				snapshot.openState,
				snapshot.removed,
				snapshot.hasMore,
				turnEnds
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
			store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
				status: "idle",
				error: null,
				pending: null,
				timeline: null,
				drafts: emptyDrafts()
			});
			face;
			generation = 0;
			sessions;
			sessionSource;
			sessionSourceDispose;
			sessionRevision;
			listRevision = "";
			refreshScheduled = false;
			observing = false;
			navigationWaits = /* @__PURE__ */ new Set();
			constructor(ctx, sessionId) {
				this.sessionId = sessionId;
				this.sessions = ctx.get("sessions");
				this.face = {
					hooks: { messageEdit: this.store },
					load: () => {
						this.load();
					},
					save: (message, text) => {
						this.saveDraft(message, text);
					},
					delete: (message) => {
						this.deleteDraft(message);
					},
					restore: (message) => {
						this.restoreDraft(message);
					},
					commit: (message, text, cascade) => this.commitDraft(message, text, cascade),
					commitTurn: (turn, cascade) => this.commitTurn(turn, cascade),
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
				ctx.effect(() => this.observeDependencies(), `message-edit: observe ${sessionId}`);
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
				const source = this.sessions.binding(this.sessionId)?.session;
				if (source === this.sessionSource) return false;
				this.sessionSourceDispose?.();
				this.sessionSource = source;
				this.sessionRevision = source === void 0 ? void 0 : conversationRevision(source.getSnapshot());
				this.sessionSourceDispose = source?.subscribe(() => {
					if (this.sessionSource !== source) return;
					const revision = conversationRevision(source.getSnapshot());
					if (revision === this.sessionRevision) return;
					this.sessionRevision = revision;
					this.invalidate();
				});
				return true;
			}
			invalidate() {
				if (!this.observing || this.store.getSnapshot().status === "idle" || this.refreshScheduled) return;
				this.refreshScheduled = true;
				queueMicrotask(() => {
					this.refreshScheduled = false;
					if (this.observing && this.store.getSnapshot().status !== "idle") this.load();
				});
			}
			/** Refetch the full value-level projection; only the newest request commits. */
			async load() {
				const generation = ++this.generation;
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				try {
					const timeline = decodeTimeline(await responseValue(await fetch(`${MESSAGE_EDIT_PATH}?sessionId=${encodeURIComponent(this.sessionId)}`, {
						method: "GET",
						headers: { accept: "application/json" },
						cache: "no-store"
					})));
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "ready";
						state.error = null;
						state.timeline = timeline;
						state.drafts = pruneDrafts(state.drafts, timeline);
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
				if (this.store.getSnapshot().status !== "idle") this.load();
			}
			saveDraft(message, text) {
				this.store.update((state) => {
					const timeline = state.timeline;
					if (timeline === null || !timeline.messages.some((candidate) => candidate.key === message.key)) {
						state.error = "要保存的消息已不在当前会话中。";
						return;
					}
					const textByKey = { ...state.drafts.textByKey };
					if (text === message.text) delete textByKey[message.key];
					else textByKey[message.key] = text;
					state.drafts = {
						...state.drafts,
						textByKey
					};
					state.error = null;
				});
			}
			deleteDraft(message) {
				this.store.update((state) => {
					const textByKey = { ...state.drafts.textByKey };
					for (const key of Object.keys(textByKey)) if (key.startsWith(`${String(message.eventSeq)}:`)) delete textByKey[key];
					state.drafts = {
						textByKey,
						deletedEventSeqs: [.../* @__PURE__ */ new Set([...state.drafts.deletedEventSeqs, message.eventSeq])]
					};
					state.error = null;
				});
			}
			restoreDraft(message) {
				this.store.update((state) => {
					state.drafts = {
						...state.drafts,
						deletedEventSeqs: state.drafts.deletedEventSeqs.filter((eventSeq) => eventSeq !== message.eventSeq)
					};
					state.error = null;
				});
			}
			draftChangesForTurn(turn) {
				const state = this.store.getSnapshot();
				const timeline = state.timeline;
				if (timeline === null) return void 0;
				const deleted = new Set(state.drafts.deletedEventSeqs);
				const deletedAdded = /* @__PURE__ */ new Set();
				const changes = [];
				for (const message of timeline.messages) {
					if (message.turn !== turn) continue;
					if (deleted.has(message.eventSeq)) {
						if (!deletedAdded.has(message.eventSeq)) {
							changes.push({
								action: "delete",
								eventSeq: message.eventSeq
							});
							deletedAdded.add(message.eventSeq);
						}
						continue;
					}
					const text = state.drafts.textByKey[message.key];
					if (text !== void 0 && text !== message.text) changes.push({
						action: "replace",
						eventSeq: message.eventSeq,
						blockIndex: message.blockIndex,
						text
					});
				}
				return changes;
			}
			async commitDraft(message, text, cascade) {
				this.saveDraft(message, text);
				return this.commitTurn(message.turn, cascade);
			}
			async commitTurn(turn, cascade) {
				const changes = this.draftChangesForTurn(turn);
				if (changes === void 0) return false;
				if (changes.length === 0) {
					this.store.update((state) => {
						state.error = "此回合没有已保存的编辑草稿。";
					});
					return false;
				}
				const applied = await this.mutate({
					action: "edit",
					sessionId: this.sessionId,
					turn,
					changes,
					cascade
				});
				if (applied) this.clearTurnDraft(turn);
				return applied;
			}
			clearTurnDraft(turn) {
				this.store.update((state) => {
					const messages = state.timeline?.messages.filter((message) => message.turn === turn) ?? [];
					const keys = new Set(messages.map((message) => message.key));
					const eventSeqs = new Set(messages.map((message) => message.eventSeq));
					state.drafts = {
						textByKey: Object.fromEntries(Object.entries(state.drafts.textByKey).filter(([key]) => !keys.has(key))),
						deletedEventSeqs: state.drafts.deletedEventSeqs.filter((eventSeq) => !eventSeqs.has(eventSeq))
					};
				});
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
					this.store.update((state) => {
						state.pending = null;
					});
					await this.openWhenListed(result.sessionId);
					return true;
				} catch (error) {
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
					this.sessions.open(sessionId);
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
						if (open) this.sessions.open(sessionId);
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
		//#region \0dsh-css:D:\AI\code\dsh-message-edit-main\src\client\InlineMessageEdit.module.css.mjs
		const css$2 = ".ZcaxqG_overlay{z-index:1000;background:var(--dsw-alias-bg-mask,#00000073);justify-content:center;align-items:center;display:flex;position:fixed;inset:0}.ZcaxqG_panel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:10px;width:560px;padding:14px 16px}.ZcaxqG_title{color:var(--dsw-alias-label-primary);padding:4px 0 10px;font-size:13px}.ZcaxqG_input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);width:100%;min-height:160px;color:var(--dsw-alias-label-primary);font:inherit;resize:vertical;border-radius:8px;padding:10px}.ZcaxqG_footer{justify-content:flex-end;gap:8px;padding:10px 0 0;display:flex}.ZcaxqG_footer button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;padding:6px 14px}.ZcaxqG_footer .ZcaxqG_primaryButton,.ZcaxqG_footer .ZcaxqG_dangerButton{color:var(--dsw-alias-label-primary-foreground);border-color:#0000}.ZcaxqG_footer .ZcaxqG_primaryButton{background:var(--dsw-alias-button-primary-fill)}.ZcaxqG_footer .ZcaxqG_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.ZcaxqG_footer .ZcaxqG_dangerButton{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 68%, var(--dsw-alias-label-tertiary))}.ZcaxqG_footer .ZcaxqG_dangerButton:hover:not(:disabled){opacity:.86}.ZcaxqG_iconButton{width:20px;height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:4px;justify-content:center;align-items:center;padding:2px;display:inline-flex}.ZcaxqG_iconButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-hover)}.ZcaxqG_picker{flex-direction:column;gap:6px;padding:4px 0 12px;display:flex}.ZcaxqG_pickerItem{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;border-radius:6px;padding:8px 10px;font-size:12px}.ZcaxqG_pickerItem:hover{background:var(--dsw-alias-bg-module-platform)}.ZcaxqG_pickerItemActive{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;align-self:flex-end;padding:6px 14px}";
		const tagId$2 = "dsh-message-edit/InlineMessageEdit.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var InlineMessageEdit_module_css_default = {
			"primaryButton": "ZcaxqG_primaryButton",
			"title": "ZcaxqG_title",
			"overlay": "ZcaxqG_overlay",
			"picker": "ZcaxqG_picker",
			"pickerItem": "ZcaxqG_pickerItem",
			"footer": "ZcaxqG_footer",
			"pickerItemActive": "ZcaxqG_pickerItemActive",
			"input": "ZcaxqG_input",
			"dangerButton": "ZcaxqG_dangerButton",
			"panel": "ZcaxqG_panel",
			"iconButton": "ZcaxqG_iconButton"
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
			pickerItemActive: InlineMessageEdit_module_css_default["pickerItemActive"] ?? "",
			primaryButton: InlineMessageEdit_module_css_default["primaryButton"] ?? "",
			dangerButton: InlineMessageEdit_module_css_default["dangerButton"] ?? ""
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
		function mountEditor(block, text, saveDraft, deleteDraft, commit, close) {
			const overlay = document.createElement("div");
			overlay.className = STYLE.overlay;
			const panel = document.createElement("div");
			panel.className = STYLE.panel;
			const title = document.createElement("div");
			title.className = STYLE.title;
			title.textContent = blockTitle(block.kind);
			const input = document.createElement("textarea");
			input.className = STYLE.input;
			input.value = text;
			const footer = document.createElement("div");
			footer.className = STYLE.footer;
			const save = document.createElement("button");
			save.textContent = "保存";
			const apply = document.createElement("button");
			apply.className = STYLE.primaryButton;
			apply.textContent = "保存并重新生成";
			const remove = document.createElement("button");
			remove.className = STYLE.dangerButton;
			remove.textContent = "删除";
			const cancel = document.createElement("button");
			cancel.textContent = "取消";
			footer.append(save);
			footer.append(remove);
			footer.append(apply, cancel);
			panel.append(title, input, footer);
			overlay.appendChild(panel);
			document.body.appendChild(overlay);
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			let mounted = true;
			let committing = false;
			const saveEdit = () => {
				if (committing) return;
				saveDraft(block, input.value);
				close();
			};
			const commitEdit = () => {
				if (committing) return;
				committing = true;
				save.disabled = true;
				apply.disabled = true;
				commit(block, input.value, "truncate").then((applied) => {
					if (!mounted) return;
					if (applied) {
						close();
						return;
					}
					committing = false;
					save.disabled = false;
					apply.disabled = false;
				});
			};
			const deleteEdit = () => {
				if (committing) return;
				deleteDraft(block);
				close();
			};
			const cancelEdit = () => {
				close();
			};
			const dismiss = (event) => {
				if (event.target === overlay) close();
			};
			save.addEventListener("click", saveEdit);
			remove.addEventListener("click", deleteEdit);
			apply.addEventListener("click", commitEdit);
			cancel.addEventListener("click", cancelEdit);
			overlay.addEventListener("click", dismiss);
			return () => {
				mounted = false;
				save.removeEventListener("click", saveEdit);
				remove.removeEventListener("click", deleteEdit);
				apply.removeEventListener("click", commitEdit);
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
		function createOverlayHost(saveDraft, deleteDraft, commit, drafts) {
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
				mount((close) => mountEditor(block, drafts.textByKey[block.key] ?? block.text, saveDraft, deleteDraft, commit, close));
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
		/** Inject retry + edit icon buttons into each message action row. */
		function InlineMessageEdit({ messages, drafts, save, delete: deleteDraft, commit, retry }) {
			(0, react.useEffect)(() => {
				const cleanups = [];
				const overlays = createOverlayHost(save, deleteDraft, commit, drafts);
				let observer;
				const sync = () => {
					const actionRows = Array.from(document.querySelectorAll("[class*=\"actions\"]"));
					const claimedEvents = /* @__PURE__ */ new Set();
					for (const row of actionRows) {
						const marker = row;
						if (marker.__messageEditInjected === true) {
							if (marker.__messageEditEventSeq !== void 0) claimedEvents.add(marker.__messageEditEventSeq);
							continue;
						}
						const text = (row.parentElement?.parentElement?.textContent ?? "").trim();
						if (text.length === 0) continue;
						const eventSeq = [...new Set(messages.filter((message) => message.text.length > 0 && text.includes(message.text.slice(0, 24))).map((message) => message.eventSeq))].find((candidate) => !claimedEvents.has(candidate));
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
				observer = new MutationObserver(sync);
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					observer?.disconnect();
					overlays.dispose();
					for (const cleanup of cleanups.reverse()) cleanup();
				};
			}, [
				messages,
				drafts,
				save,
				deleteDraft,
				commit,
				retry
			]);
			return null;
		}
		//#endregion
		//#region \0dsh-css:D:\AI\code\dsh-message-edit-main\src\client\MessageEditHeader.module.css.mjs
		const css$1 = ".ewxxhq_root{align-items:center;gap:4px;display:inline-flex}.ewxxhq_iconButton,.ewxxhq_rerollButton{box-sizing:border-box;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0}.ewxxhq_iconButton{border-radius:50%;justify-content:center;align-items:center;width:28px;height:28px;font-size:16px;line-height:20px;display:inline-flex}.ewxxhq_rerollButton{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;height:28px;padding:0 10px;font-size:12px;line-height:18px}.ewxxhq_iconButton:hover:not(:disabled),.ewxxhq_rerollButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.ewxxhq_iconButton:focus-visible,.ewxxhq_rerollButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.ewxxhq_iconButton:disabled,.ewxxhq_rerollButton:disabled{cursor:default;opacity:.4}.ewxxhq_counter{min-width:108px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:11px;line-height:18px}@media (width<=760px){.ewxxhq_counter{display:none}}";
		const tagId$1 = "dsh-message-edit/MessageEditHeader.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var MessageEditHeader_module_css_default = {
			"iconButton": "ewxxhq_iconButton",
			"rerollButton": "ewxxhq_rerollButton",
			"root": "ewxxhq_root",
			"counter": "ewxxhq_counter"
		};
		//#endregion
		//#region src/client/MessageEditHeader.tsx
		/** Header contribution shared with the Timeline controller. */
		function MessageEditHeader({ useMessageEdit, load, openVersion, reroll, save, delete: deleteDraft, commit, retry }) {
			const state = useMessageEdit((value) => value);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const timeline = state.timeline;
			const versions = state.timeline?.versions ?? [];
			const undoSessionId = timeline?.undoStack[0];
			const redoSessionId = timeline?.redoSessionIds.at(-1);
			const effectDepth = timeline?.undoStack.length ?? 0;
			const busy = state.pending !== null || state.status !== "ready";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InlineMessageEdit, {
				messages: state.status === "ready" && state.pending === null ? timeline?.messages ?? [] : [],
				drafts: state.drafts,
				save,
				delete: deleteDraft,
				commit,
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
		//#region \0dsh-css:D:\AI\code\dsh-message-edit-main\src\client\MessageEditTimelineView.module.css.mjs
		const css = "._7y6Yva_root{box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);padding:24px;overflow:auto}._7y6Yva_pageHeader{justify-content:space-between;align-items:flex-start;gap:20px;max-width:1480px;margin:0 auto 16px;display:flex}._7y6Yva_title,._7y6Yva_intro,._7y6Yva_subtitle,._7y6Yva_notice,._7y6Yva_error,._7y6Yva_empty,._7y6Yva_turnTitle,._7y6Yva_turnPreview,._7y6Yva_messageText{margin:0}._7y6Yva_title{font-size:22px;font-weight:600;line-height:30px}._7y6Yva_intro{max-width:700px;color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:13px;line-height:20px}._7y6Yva_headerActions{flex:none;align-items:flex-end;gap:8px;display:flex}._7y6Yva_cascadeField{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;font-size:11px;line-height:16px;display:flex}._7y6Yva_select,._7y6Yva_textarea,._7y6Yva_primaryButton,._7y6Yva_secondaryButton,._7y6Yva_textButton,._7y6Yva_dangerButton,._7y6Yva_versionButton{box-sizing:border-box;font:inherit}._7y6Yva_select,._7y6Yva_textarea{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-radius:8px}._7y6Yva_select{height:34px;padding:0 30px 0 9px;font-size:12px}._7y6Yva_primaryButton,._7y6Yva_secondaryButton,._7y6Yva_textButton,._7y6Yva_dangerButton,._7y6Yva_versionButton{cursor:pointer;border:0}._7y6Yva_primaryButton,._7y6Yva_secondaryButton,._7y6Yva_dangerButton{border-radius:17px;justify-content:center;align-items:center;min-height:34px;padding:0 13px;font-size:12px;line-height:18px;display:inline-flex}._7y6Yva_dangerButton{color:#fff;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 68%, var(--dsw-alias-label-tertiary));border:1px solid #0000}._7y6Yva_primaryButton{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill)}._7y6Yva_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}._7y6Yva_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}._7y6Yva_secondaryButton:hover:not(:disabled),._7y6Yva_textButton:hover:not(:disabled),._7y6Yva_versionButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}._7y6Yva_dangerButton:hover:not(:disabled){opacity:.86}._7y6Yva_primaryButton:disabled,._7y6Yva_secondaryButton:disabled,._7y6Yva_textButton:disabled,._7y6Yva_dangerButton:disabled,._7y6Yva_versionButton:disabled,._7y6Yva_select:disabled{cursor:default;opacity:.45}._7y6Yva_primaryButton:focus-visible,._7y6Yva_secondaryButton:focus-visible,._7y6Yva_textButton:focus-visible,._7y6Yva_dangerButton:focus-visible,._7y6Yva_versionButton:focus-visible,._7y6Yva_select:focus-visible,._7y6Yva_textarea:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}._7y6Yva_notice,._7y6Yva_error{max-width:1480px;margin:0 auto 10px;font-size:12px;line-height:18px}._7y6Yva_notice{color:var(--dsw-alias-state-warn-label)}._7y6Yva_error{color:var(--dsw-alias-state-error-primary)}._7y6Yva_status{box-sizing:border-box;width:100%;height:100%;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);flex-direction:column;align-items:flex-start;gap:12px;padding:24px;display:flex}._7y6Yva_status ._7y6Yva_error{margin:0}._7y6Yva_columns{grid-template-columns:minmax(280px,.72fr) minmax(520px,1.75fr);align-items:start;gap:18px;max-width:1480px;margin:0 auto;display:grid}._7y6Yva_versionsPanel,._7y6Yva_turnsPanel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;min-width:0;padding:16px}._7y6Yva_versionsPanel{position:sticky;top:0}._7y6Yva_sectionHeading{justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;display:flex}._7y6Yva_effectControls{background:var(--dsw-alias-bg-module-platform);border-radius:9px;flex-direction:column;gap:8px;margin-bottom:12px;padding:10px;display:flex}._7y6Yva_effectDepth{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}._7y6Yva_effectButtons{flex-wrap:wrap;gap:6px;display:flex}._7y6Yva_effectButtons ._7y6Yva_secondaryButton{min-height:28px;padding:0 10px;font-size:11px}._7y6Yva_subtitle{font-size:16px;font-weight:500;line-height:24px}._7y6Yva_count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}._7y6Yva_versionList,._7y6Yva_turnList{margin:0;padding:0;list-style:none}._7y6Yva_versionList{flex-direction:column;gap:4px;display:flex}._7y6Yva_versionItem{--message-edit-depth:0;padding-left:calc(var(--message-edit-depth) * 14px);position:relative}._7y6Yva_versionButton{width:100%;min-width:0;color:var(--dsw-alias-label-secondary);text-align:left;background:0 0;border-radius:9px;align-items:flex-start;gap:9px;padding:9px;display:flex;position:relative}._7y6Yva_versionButton[data-current]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);opacity:1}._7y6Yva_versionButton:not([data-current]) ._7y6Yva_pathBadge{opacity:.8}._7y6Yva_versionLine{background:var(--dsw-alias-border-l2);width:1px;position:absolute;top:0;bottom:0;left:14px}._7y6Yva_versionDot{z-index:1;border:2px solid var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-label-tertiary);border-radius:50%;flex:none;width:7px;height:7px;margin-top:6px}._7y6Yva_versionButton[data-current] ._7y6Yva_versionDot{border-color:var(--dsw-alias-bg-module-platform);background:var(--dsw-alias-brand-primary)}._7y6Yva_versionMain{flex-direction:column;flex:1;min-width:0;display:flex}._7y6Yva_versionTitle{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}._7y6Yva_versionMeta{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;overflow:hidden}._7y6Yva_versionDiff{color:var(--dsw-alias-label-tertiary);flex-direction:column;gap:2px;margin-top:5px;font-size:10px;line-height:15px;display:flex}._7y6Yva_versionDiff span{-webkit-line-clamp:2;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}._7y6Yva_currentBadge,._7y6Yva_pathBadge,._7y6Yva_kindBadge{border-radius:9px;flex:none;padding:1px 6px;font-size:10px;line-height:17px}._7y6Yva_currentBadge{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}._7y6Yva_pathBadge{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}._7y6Yva_turnList{flex-direction:column;gap:14px;display:flex}._7y6Yva_turnSection{border:1px solid var(--dsw-alias-border-l2);border-radius:11px;padding:13px}._7y6Yva_turnHeader,._7y6Yva_messageHeader,._7y6Yva_editorActions{justify-content:space-between;align-items:center;gap:10px;display:flex}._7y6Yva_turnActions,._7y6Yva_editorButtons{flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:7px;display:flex}._7y6Yva_turnHeader{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:flex-start;padding-bottom:11px}._7y6Yva_turnTitle{font-size:14px;font-weight:500;line-height:22px}._7y6Yva_turnPreview{max-width:700px;color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;white-space:pre-wrap;-webkit-box-orient:vertical;font-size:11px;line-height:17px;display:-webkit-box;overflow:hidden}._7y6Yva_messageList{flex-direction:column;gap:8px;margin-top:10px;display:flex}._7y6Yva_messageCard{background:var(--dsw-alias-bg-module-platform);border-radius:9px;padding:10px}._7y6Yva_messageCard[data-draft]{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3)}._7y6Yva_messageCard[data-deleted]{opacity:.72}._7y6Yva_messageHeader{justify-content:flex-start}._7y6Yva_kindBadge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}._7y6Yva_kindBadge[data-kind=assistant\\.reasoning]{color:var(--dsw-alias-label-tertiary)}._7y6Yva_messageTime{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:17px}._7y6Yva_draftBadge{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);border-radius:9px;padding:1px 6px;font-size:10px;line-height:17px}._7y6Yva_textButton{color:var(--dsw-alias-label-secondary);background:0 0;border-radius:12px;margin-left:auto;padding:3px 8px;font-size:11px;line-height:17px}._7y6Yva_messageText{max-height:220px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7px;font-family:inherit;font-size:12px;line-height:19px;overflow:auto}._7y6Yva_editor{margin-top:8px}._7y6Yva_textarea{resize:vertical;width:100%;min-height:120px;padding:9px;font-size:12px;line-height:19px}._7y6Yva_editorActions{margin-top:8px}._7y6Yva_editorHint{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}._7y6Yva_deletedNotice{color:var(--dsw-alias-state-error-primary);margin:8px 0 0;font-size:11px;line-height:18px}._7y6Yva_empty{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:18px;font-size:13px;line-height:20px}@media (width<=1000px){._7y6Yva_columns{grid-template-columns:1fr}._7y6Yva_versionsPanel{position:static}}@media (width<=680px){._7y6Yva_root{padding:16px}._7y6Yva_pageHeader,._7y6Yva_headerActions,._7y6Yva_turnHeader,._7y6Yva_editorActions,._7y6Yva_turnActions,._7y6Yva_editorButtons{flex-direction:column;align-items:stretch}._7y6Yva_headerActions,._7y6Yva_primaryButton,._7y6Yva_secondaryButton,._7y6Yva_dangerButton{width:100%}}";
		const tagId = "dsh-message-edit/MessageEditTimelineView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var MessageEditTimelineView_module_css_default = {
			"versionsPanel": "_7y6Yva_versionsPanel",
			"primaryButton": "_7y6Yva_primaryButton",
			"effectButtons": "_7y6Yva_effectButtons",
			"versionDiff": "_7y6Yva_versionDiff",
			"versionLine": "_7y6Yva_versionLine",
			"versionTitle": "_7y6Yva_versionTitle",
			"turnActions": "_7y6Yva_turnActions",
			"status": "_7y6Yva_status",
			"turnList": "_7y6Yva_turnList",
			"textarea": "_7y6Yva_textarea",
			"secondaryButton": "_7y6Yva_secondaryButton",
			"editorButtons": "_7y6Yva_editorButtons",
			"effectControls": "_7y6Yva_effectControls",
			"intro": "_7y6Yva_intro",
			"turnsPanel": "_7y6Yva_turnsPanel",
			"count": "_7y6Yva_count",
			"messageText": "_7y6Yva_messageText",
			"turnHeader": "_7y6Yva_turnHeader",
			"subtitle": "_7y6Yva_subtitle",
			"turnTitle": "_7y6Yva_turnTitle",
			"messageHeader": "_7y6Yva_messageHeader",
			"effectDepth": "_7y6Yva_effectDepth",
			"versionMeta": "_7y6Yva_versionMeta",
			"versionList": "_7y6Yva_versionList",
			"editorHint": "_7y6Yva_editorHint",
			"textButton": "_7y6Yva_textButton",
			"messageList": "_7y6Yva_messageList",
			"messageTime": "_7y6Yva_messageTime",
			"editor": "_7y6Yva_editor",
			"root": "_7y6Yva_root",
			"notice": "_7y6Yva_notice",
			"turnPreview": "_7y6Yva_turnPreview",
			"cascadeField": "_7y6Yva_cascadeField",
			"messageCard": "_7y6Yva_messageCard",
			"turnSection": "_7y6Yva_turnSection",
			"currentBadge": "_7y6Yva_currentBadge",
			"draftBadge": "_7y6Yva_draftBadge",
			"deletedNotice": "_7y6Yva_deletedNotice",
			"columns": "_7y6Yva_columns",
			"pageHeader": "_7y6Yva_pageHeader",
			"dangerButton": "_7y6Yva_dangerButton",
			"versionMain": "_7y6Yva_versionMain",
			"pathBadge": "_7y6Yva_pathBadge",
			"versionDot": "_7y6Yva_versionDot",
			"kindBadge": "_7y6Yva_kindBadge",
			"sectionHeading": "_7y6Yva_sectionHeading",
			"title": "_7y6Yva_title",
			"error": "_7y6Yva_error",
			"empty": "_7y6Yva_empty",
			"headerActions": "_7y6Yva_headerActions",
			"select": "_7y6Yva_select",
			"editorActions": "_7y6Yva_editorActions",
			"versionButton": "_7y6Yva_versionButton",
			"versionItem": "_7y6Yva_versionItem"
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
		function draftedText(message, textByKey) {
			return textByKey[message.key] ?? message.text;
		}
		function isDraftDeleted(message, deletedEventSeqs) {
			return deletedEventSeqs.includes(message.eventSeq);
		}
		function turnDraftCount(messages, textByKey, deletedEventSeqs) {
			const deleted = new Set(deletedEventSeqs);
			return new Set(messages.filter((message) => deleted.has(message.eventSeq)).map((message) => message.eventSeq)).size + messages.filter((message) => !deleted.has(message.eventSeq) && draftedText(message, textByKey) !== message.text).length;
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
		function MessageCard({ message, editing, textByKey, deletedEventSeqs, disabled, cascade, onBeginEdit, onCancelEdit, onTextChange, onSave, onCommit, onDelete, onRestore }) {
			const active = editing?.message.key === message.key;
			const deleted = isDraftDeleted(message, deletedEventSeqs);
			const text = draftedText(message, textByKey);
			const hasDraft = deleted || text !== message.text;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: MessageEditTimelineView_module_css_default["messageCard"],
				"data-draft": hasDraft || void 0,
				"data-deleted": deleted || void 0,
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
						hasDraft ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["draftBadge"],
							children: "草稿"
						}) : null,
						deleted ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageEditTimelineView_module_css_default["textButton"],
							disabled,
							onClick: () => {
								onRestore(message);
							},
							children: "撤销删除"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageEditTimelineView_module_css_default["textButton"],
							disabled,
							onClick: () => {
								active ? onCancelEdit() : onBeginEdit(message);
							},
							children: active ? "取消" : "编辑"
						}) })
					]
				}), deleted ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: MessageEditTimelineView_module_css_default["deletedNotice"],
					children: "已保存到草稿；保存并重新生成后，这条消息将不存在于新分支中。"
				}) : active && editing !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
							children: "保存只写入草稿；保存并重新生成才会创建分支。"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MessageEditTimelineView_module_css_default["editorButtons"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MessageEditTimelineView_module_css_default["secondaryButton"],
									disabled,
									onClick: () => {
										onSave(message, editing.text);
									},
									children: "保存"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MessageEditTimelineView_module_css_default["dangerButton"],
									disabled,
									onClick: () => {
										onDelete(message);
									},
									children: "删除"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MessageEditTimelineView_module_css_default["primaryButton"],
									disabled,
									onClick: () => {
										onCommit(message, editing.text, cascade);
									},
									children: "保存并重新生成"
								})
							]
						})]
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: MessageEditTimelineView_module_css_default["messageText"],
					children: text || "（空内容）"
				})]
			});
		}
		/** Conversation-view entry point. */
		function MessageEditTimelineView({ useMessageEdit, load, save, delete: deleteDraft, restore, commit, commitTurn, retry, reroll, openVersion }) {
			const state = useMessageEdit((value) => value);
			const [cascade, setCascade] = (0, react.useState)("truncate");
			const [editing, setEditing] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
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
			const saveEdit = (message, text) => {
				save(message, text);
				setEditing(null);
			};
			const commitEdit = async (message, text, policy) => {
				const applied = await commit(message, text, policy);
				if (applied) setEditing(null);
				return applied;
			};
			const deleteEdit = (message) => {
				deleteDraft(message);
				setEditing((current) => current?.message.eventSeq === message.eventSeq ? null : current);
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
										})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: MessageEditTimelineView_module_css_default["turnActions"],
											children: [section.retry.retryable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: MessageEditTimelineView_module_css_default["secondaryButton"],
												disabled: busy,
												onClick: () => {
													retry(section.retry.turn, cascade);
												},
												children: state.pending === "retry" ? "正在重试…" : "重试此回合"
											}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: MessageEditTimelineView_module_css_default["primaryButton"],
												disabled: busy || turnDraftCount(section.messages, state.drafts.textByKey, state.drafts.deletedEventSeqs) === 0,
												onClick: () => {
													commitTurn(section.retry.turn, cascade);
												},
												children: state.pending === "edit" ? "正在保存并重新生成…" : `保存并重新生成 (${String(turnDraftCount(section.messages, state.drafts.textByKey, state.drafts.deletedEventSeqs))})`
											})]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: MessageEditTimelineView_module_css_default["messageList"],
										children: section.messages.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageCard, {
											message,
											editing,
											textByKey: state.drafts.textByKey,
											deletedEventSeqs: state.drafts.deletedEventSeqs,
											disabled: busy,
											cascade,
											onBeginEdit: (value) => {
												setEditing({
													message: value,
													text: draftedText(value, state.drafts.textByKey)
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
											onSave: saveEdit,
											onCommit: commitEdit,
											onDelete: deleteEdit,
											onRestore: restore
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
		/** Explicit value sources and slot declaration-order edges. */
		const inject = [
			"slots",
			"conversation",
			"connection",
			"sessions"
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
			ctx.on("connection/reset", () => {
				for (const controller of controllers.values()) controller.refreshIfLoaded();
			});
			ctx.slots.register({
				name: "conversation.view",
				id: "message-edit-timeline",
				order: 15,
				label: "Timeline",
				inject: (sessionId) => controllerFor(sessionId).face
			}, MessageEditTimelineView);
			ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "message-edit-controls",
				order: 15,
				inject: (sessionId) => controllerFor(sessionId).face
			}, MessageEditHeader);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map