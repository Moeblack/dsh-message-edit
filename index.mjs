//#region src/shared.ts
/** Same-origin endpoint owned by the Message Edit host plugin. */
const MESSAGE_EDIT_PATH = "/message-edit";
/** Timeline sits between Trajectory (10) and Prompt Studio (20). */
const MESSAGE_EDIT_VIEW_ORDER = 15;
/** Current durable event schema for structurally paired version effects. */
const MESSAGE_EDIT_VERSION_SCHEMA = 2;
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "message-edit";
/** Public services used by the branch transaction and timeline projection. */
const inject = [
	"sessions",
	"agents",
	"sessionPersistence",
	"sessionQuery",
	"workspaceRegistry",
	"webServer"
];
function pairVersionEffect(sourceSessionId, effect) {
	return {
		schemaVersion: 2,
		effect: {
			...effect,
			id: crypto.randomUUID()
		},
		inverse: {
			kind: "restore-version",
			sessionId: sourceSessionId
		}
	};
}
function isTextualBlock(block) {
	return block?.type === "text" || block?.type === "reasoning";
}
function userText(message) {
	return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
function cloneUser(message, content = structuredClone(message.content)) {
	return Object.freeze({
		id: crypto.randomUUID(),
		role: "user",
		content: Object.freeze(content),
		source: Object.freeze({ kind: "user" })
	});
}
function replaceTextBlock(content, blockIndex, text) {
	const block = content[blockIndex];
	if (!isTextualBlock(block)) throw new Error("所选内容块不是可编辑文本。");
	return content.map((candidate, index) => index === blockIndex ? {
		...candidate,
		text
	} : structuredClone(candidate));
}
/** Fold complete turn brackets; an open tail is deliberately absent. */
function closedTurns(events) {
	const result = [];
	let current;
	for (const event of events) {
		if (event.type === "turn/start") {
			current = {
				turn: event.data.turn,
				startSeq: event.seq,
				assistants: []
			};
			continue;
		}
		if (current === void 0) continue;
		if (event.type === "user/message" && current.user === void 0 && event.data.source.kind === "user") {
			current.user = event;
			continue;
		}
		if (event.type === "assistant/message" && event.data.turn === current.turn) {
			current.assistants.push(event);
			continue;
		}
		if (event.type === "turn/end" && event.data.turn === current.turn) {
			result.push({
				...current,
				endSeq: event.seq
			});
			current = void 0;
		}
	}
	return result;
}
function editableMessages(turns) {
	const result = [];
	for (const turn of turns) {
		if (turn.user !== void 0) for (const [blockIndex, block] of turn.user.data.content.entries()) {
			if (block.type !== "text") continue;
			result.push({
				key: `${String(turn.user.seq)}:${String(blockIndex)}`,
				turn: turn.turn,
				eventSeq: turn.user.seq,
				blockIndex,
				kind: "user",
				text: block.text,
				time: turn.user.time
			});
		}
		for (const event of turn.assistants) for (const [blockIndex, block] of event.data.message.content.entries()) {
			if (!isTextualBlock(block)) continue;
			result.push({
				key: `${String(event.seq)}:${String(blockIndex)}`,
				turn: turn.turn,
				eventSeq: event.seq,
				blockIndex,
				kind: block.type === "reasoning" ? "assistant.reasoning" : "assistant.response",
				text: block.text,
				time: event.time
			});
		}
	}
	return result;
}
function retryableTurns(turns) {
	return turns.flatMap((turn) => turn.user === void 0 ? [] : [{
		turn: turn.turn,
		userEventSeq: turn.user.seq,
		preview: userText(turn.user.data),
		time: turn.user.time
	}]);
}
function downstreamUsers(turns, start) {
	return turns.slice(start).flatMap((turn) => turn.user === void 0 ? [] : [cloneUser(turn.user.data)]);
}
function assistantReplacement(event, blockIndex, text) {
	const replaced = replaceTextBlock(event.data.message.content, blockIndex, text).filter((block) => block.type === "text" || block.type === "reasoning");
	return Object.freeze({
		id: crypto.randomUUID(),
		role: "assistant",
		content: Object.freeze(replaced),
		source: Object.freeze({
			kind: "model",
			provider: event.data.message.source.provider,
			model: event.data.message.source.model
		})
	});
}
function editPlan(operation, turns) {
	const turnIndex = turns.findIndex((turn) => operation.eventSeq > turn.startSeq && operation.eventSeq < turn.endSeq);
	const turn = turns[turnIndex];
	if (turn === void 0) throw new Error("所选消息不属于已落定回合。");
	const event = turn.user?.seq === operation.eventSeq ? turn.user : turn.assistants.find((candidate) => candidate.seq === operation.eventSeq);
	if (event === void 0) throw new Error("所选消息不存在或不可编辑。");
	if (event.type === "user/message") {
		const before = event.data.content[operation.blockIndex];
		if (before?.type !== "text") throw new Error("所选用户消息块不是文本。");
		const edited = cloneUser(event.data, replaceTextBlock(event.data.content, operation.blockIndex, operation.text));
		const later = operation.cascade === "preserve" ? downstreamUsers(turns, turnIndex + 1) : [];
		return {
			boundary: turn.startSeq - 1,
			version: pairVersionEffect(operation.sessionId, {
				operation: "edit",
				cascade: operation.cascade,
				targetTurn: turn.turn,
				targetEventSeq: event.seq,
				targetBlockIndex: operation.blockIndex,
				blockKind: "user",
				before: before.text,
				after: operation.text
			}),
			queuedUsers: [edited, ...later]
		};
	}
	const before = event.data.message.content[operation.blockIndex];
	if (!isTextualBlock(before)) throw new Error("所选助手消息块不是文本或思考。");
	const blockKind = before.type === "reasoning" ? "assistant.reasoning" : "assistant.response";
	if (turn.user === void 0) throw new Error("所选助手消息没有可重建的用户输入。");
	return {
		boundary: turn.startSeq - 1,
		version: pairVersionEffect(operation.sessionId, {
			operation: "edit",
			cascade: operation.cascade,
			targetTurn: turn.turn,
			targetEventSeq: event.seq,
			targetBlockIndex: operation.blockIndex,
			blockKind,
			before: before.text,
			after: operation.text
		}),
		manualTurn: {
			turn: turn.turn,
			user: cloneUser(turn.user.data),
			assistant: assistantReplacement(event, operation.blockIndex, operation.text)
		},
		queuedUsers: operation.cascade === "preserve" ? downstreamUsers(turns, turnIndex + 1) : []
	};
}
function retryPlan(sessionId, turnNumber, cascade, turns) {
	const turnIndex = turns.findIndex((turn) => turn.turn === turnNumber);
	const turn = turns[turnIndex];
	if (turn?.user === void 0) throw new Error("所选回合没有可重放的用户输入。");
	return {
		boundary: turn.startSeq - 1,
		version: pairVersionEffect(sessionId, {
			operation: "retry",
			cascade,
			targetTurn: turn.turn,
			targetEventSeq: turn.user.seq
		}),
		queuedUsers: cascade === "preserve" ? downstreamUsers(turns, turnIndex) : [cloneUser(turn.user.data)]
	};
}
function rerollPlan(sessionId, turns) {
	for (let index = turns.length - 1; index >= 0; index -= 1) {
		const turn = turns[index];
		if (turn?.user === void 0) continue;
		const target = turn.assistants.findLast((event) => event.data.message.content.some(isTextualBlock));
		if (target === void 0) continue;
		return {
			boundary: turn.startSeq - 1,
			version: pairVersionEffect(sessionId, {
				operation: "reroll",
				cascade: "truncate",
				targetTurn: turn.turn,
				targetEventSeq: target.seq
			}),
			queuedUsers: [cloneUser(turn.user.data)]
		};
	}
	throw new Error("当前会话没有可重生成的已落定助手回复。");
}
function planOperation(operation, events) {
	const turns = closedTurns(events);
	switch (operation.action) {
		case "edit": return editPlan(operation, turns);
		case "reroll": return rerollPlan(operation.sessionId, turns);
		case "retry": return retryPlan(operation.sessionId, operation.turn, operation.cascade, turns);
	}
}
function agentOptions(events, fallback) {
	const config = events.findLast((event) => event.type === "request/header")?.data.header.config;
	const provider = config?.provider ?? fallback?.provider;
	const model = config?.model ?? fallback?.model;
	if (provider === void 0 || provider.length === 0 || model === void 0 || model.length === 0) throw new Error("无法从会话历史解析模型路由。");
	const maxTokens = config?.maxTokens ?? fallback?.maxTokens;
	return {
		provider,
		model,
		...maxTokens === void 0 ? {} : { maxTokens }
	};
}
async function withSourceAgent(ctx, sessionId, operation) {
	let handle;
	let agent = ctx.agents.get(sessionId);
	if (agent === void 0) {
		const snapshot = await ctx.sessionQuery.readSession(sessionId);
		handle = await ctx.agents.resume({
			resumeSessionId: sessionId,
			agentOptions: agentOptions(snapshot.events)
		});
		agent = handle.agent;
	}
	try {
		return await agent.runMaintenance(async () => operation(agent));
	} finally {
		await handle?.dispose();
	}
}
function inheritedSeed(source, boundary) {
	if (boundary === -1) return [];
	const boundaryEvent = source.events[boundary];
	if (boundary < 0 || boundaryEvent === void 0 || boundaryEvent.seq !== boundary) throw new Error("分支边界不是连续会话事件。");
	return source.events.slice(0, boundary + 1);
}
/** Build seed envelopes locally; Session construction performs canonical validation and freezing. */
function appendLogSeedEvent(events, type, data) {
	events.push({
		type,
		seq: events.length,
		time: Date.now(),
		data,
		...type.startsWith("message-edit/") ? { ignorable: true } : {}
	});
}
function appendSurfaceSeedEvent(events, type, data, intent) {
	events.push({
		type,
		seq: events.length,
		time: Date.now(),
		data,
		surfaceOp: intent.surfaceOp,
		...intent.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: intent.sourceEventSeqs }
	});
}
function appendManualTurn(events, manual) {
	const { turn, user, assistant } = manual;
	appendLogSeedEvent(events, "turn/start", { turn });
	appendSurfaceSeedEvent(events, "user/message", user, { surfaceOp: "append" });
	appendLogSeedEvent(events, "step/start", {
		turn,
		step: 1
	});
	appendSurfaceSeedEvent(events, "assistant/message", {
		turn,
		step: 1,
		message: assistant
	}, {
		surfaceOp: "append",
		sourceEventSeqs: []
	});
	appendLogSeedEvent(events, "step/end", {
		turn,
		step: 1
	});
	appendLogSeedEvent(events, "turn/end", {
		turn,
		reason: { kind: "completed" }
	});
}
function versionSeed(source, plan) {
	const events = inheritedSeed(source, plan.boundary);
	const inheritedLength = events.length;
	appendLogSeedEvent(events, "message-edit/version", plan.version);
	if (plan.manualTurn !== void 0) appendManualTurn(events, plan.manualTurn);
	return {
		events,
		inheritedLength
	};
}
function sessionPreset(session) {
	for (let index = session.events.length - 1; index >= 0; index -= 1) {
		const event = session.events[index];
		if (event?.type === "agent-preset/selected") return event.data.agentPreset;
	}
	return session.header.agentPreset;
}
async function createVersionAgent(ctx, source, childId, plan, options) {
	const seed = versionSeed(source, plan);
	const presets = ctx.get("agentPresets");
	const presetId = sessionPreset(source);
	let agentPreset;
	let setup;
	if (presets !== void 0 && presetId !== void 0) {
		const resolved = (await presets.resolve(presetId)).id;
		agentPreset = resolved;
		setup = async (agentCtx) => {
			await presets.mount(agentCtx, resolved);
		};
	}
	const child = await ctx.agents.create({
		sessionId: childId,
		seed: seed.events,
		meta: {
			...source.header.cwd === void 0 ? {} : { cwd: source.header.cwd },
			parentSession: source.id,
			seedLength: seed.inheritedLength,
			...agentPreset === void 0 ? {} : { agentPreset }
		},
		agentOptions: options,
		...setup === void 0 ? {} : { setup }
	});
	try {
		await ctx.sessions.flush(child.agent.session);
		return child;
	} catch (error) {
		await child.dispose();
		throw error;
	}
}
function sourceWorkspace(ctx, sessionId) {
	return ctx.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(sessionId));
}
async function recoverOperation(inverses) {
	const failures = [];
	for (const inverse of inverses.reverse()) try {
		await inverse();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length > 0) throw new AggregateError(failures, "版本操作恢复失败。");
}
async function runOperation(ctx, operation) {
	const sourceId = sessionIdOf(operation.sessionId);
	return withSourceAgent(ctx, sourceId, async (source) => {
		const childId = sessionIdOf(`session-${crypto.randomUUID()}`);
		const inverses = [];
		try {
			const events = source.session.events;
			const plan = planOperation(operation, events);
			const options = agentOptions(events, source.options);
			const child = await createVersionAgent(ctx, source.session, childId, plan, options);
			inverses.push(() => child.dispose());
			const workspace = sourceWorkspace(ctx, sourceId);
			if (workspace !== void 0) {
				await workspace.attachSession(childId);
				inverses.push(() => workspace.detachSession(childId));
			}
			for (const message of plan.queuedUsers) child.agent.followup(message);
			inverses.length = 0;
			return {
				sessionId: childId,
				queuedTurns: plan.queuedUsers.length
			};
		} catch (error) {
			try {
				await recoverOperation(inverses);
			} catch (recoveryError) {
				throw new AggregateError([error, recoveryError], "版本操作及其恢复均失败。");
			}
			throw error;
		}
	});
}
function ownVersionEvent(header, events) {
	const inherited = header.seedLength ?? 0;
	const ownEvents = events.filter((event) => event.type === "message-edit/version" && event.seq >= inherited);
	if (ownEvents.length === 0) return void 0;
	if (ownEvents.length > 1) throw new Error(`会话 ${header.id} 包含多个自身版本效果。`);
	const event = ownEvents[0];
	if (event === void 0) return void 0;
	const parent = header.parentSession;
	if ("schemaVersion" in event.data) {
		const version = event.data;
		if (version.schemaVersion !== 2) throw new Error(`会话 ${header.id} 使用不支持的版本效果结构。`);
		if (version.inverse.kind !== "restore-version" || parent === void 0 || version.inverse.sessionId !== parent) throw new Error(`会话 ${header.id} 的版本效果与逆不匹配。`);
		return {
			effect: version.effect,
			inverseSessionId: version.inverse.sessionId,
			time: event.time
		};
	}
	const legacy = event.data;
	if (parent === void 0 || legacy.sourceSessionId !== parent) throw new Error(`会话 ${header.id} 的旧版恢复目标与父版本不匹配。`);
	return {
		effect: {
			id: `legacy:${header.id}:${String(event.seq)}`,
			operation: legacy.operation,
			cascade: legacy.cascade,
			targetTurn: legacy.targetTurn,
			targetEventSeq: legacy.targetEventSeq,
			...legacy.targetBlockIndex === void 0 ? {} : { targetBlockIndex: legacy.targetBlockIndex },
			...legacy.blockKind === void 0 ? {} : { blockKind: legacy.blockKind },
			...legacy.before === void 0 ? {} : { before: legacy.before },
			...legacy.after === void 0 ? {} : { after: legacy.after }
		},
		inverseSessionId: legacy.sourceSessionId,
		time: event.time
	};
}
function flattenLineage(root, descendants) {
	const result = [{
		record: root,
		depth: 0
	}];
	const visit = (nodes, depth) => {
		const ordered = [...nodes].sort((left, right) => left.session.header.createdAt - right.session.header.createdAt || String(left.session.header.id).localeCompare(String(right.session.header.id)));
		for (const node of ordered) {
			result.push({
				record: node.session,
				depth
			});
			visit(node.descendants, depth + 1);
		}
	};
	visit(descendants, 1);
	return result;
}
/** Bounded parallel inspection of persisted branches; matches the corpus worker shape. */
const TIMELINE_READ_CONCURRENCY = 4;
async function mapConcurrent(items, worker) {
	const results = new Array(items.length);
	let cursor = 0;
	const run = async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index]);
		}
	};
	const workers = Math.min(TIMELINE_READ_CONCURRENCY, items.length);
	await Promise.all(Array.from({ length: workers }, () => run()));
	return results;
}
/** Full log for the requested session: live borrow, persisted inspection, query fallback. */
async function readCurrentLog(ctx, sessionId) {
	const live = ctx.sessions.get(sessionId);
	if (live !== void 0) return live.events;
	const persistence = ctx.get("sessionPersistence");
	if (persistence !== void 0) return (await persistence.inspect(sessionId)).events;
	return (await ctx.sessionQuery.readSession(sessionId)).events;
}
/** Own-version scan window for one lineage node: the tail from the durable
* seed boundary is enough, and root nodes cannot carry a version effect. */
async function versionLog(ctx, record) {
	const inherited = record.header.seedLength ?? 0;
	const live = ctx.sessions.get(record.header.id);
	if (live !== void 0) return live.events.slice(inherited);
	const persistence = ctx.get("sessionPersistence");
	if (persistence !== void 0) return (await persistence.readFrom(record.header.id, inherited)).events;
	return (await ctx.sessionQuery.readSession(record.header.id)).events.slice(inherited);
}
async function timeline(ctx, sessionId) {
	const targetTrace = await ctx.sessionQuery.traceSession(sessionId);
	const rootId = targetTrace.complete ? targetTrace.root.header.id : targetTrace.ancestors.at(-1)?.header.id ?? sessionId;
	const rootTrace = rootId === sessionId ? targetTrace : await ctx.sessionQuery.traceSession(rootId);
	const lineage = flattenLineage(rootTrace.target, rootTrace.descendants);
	const logs = await mapConcurrent(lineage, async ({ record }) => {
		if (record.header.id === sessionId) return readCurrentLog(ctx, sessionId);
		if (record.header.parentSession === void 0) return [];
		return versionLog(ctx, record);
	});
	const recordsById = new Map(lineage.map(({ record }) => [record.header.id, record]));
	const currentPath = /* @__PURE__ */ new Set();
	let pathId = sessionId;
	while (pathId !== void 0 && !currentPath.has(pathId)) {
		currentPath.add(pathId);
		pathId = recordsById.get(pathId)?.header.parentSession;
	}
	const versions = lineage.map(({ record, depth }, index) => {
		const version = ownVersionEvent(record.header, logs[index] ?? []);
		return {
			sessionId: record.header.id,
			...record.header.parentSession === void 0 ? {} : { parentSessionId: record.header.parentSession },
			...version === void 0 ? {} : {
				effectId: version.effect.id,
				inverseSessionId: version.inverseSessionId
			},
			createdAt: version?.time ?? record.header.createdAt,
			depth,
			current: record.header.id === sessionId,
			onCurrentEffectPath: currentPath.has(record.header.id),
			...version === void 0 ? {} : {
				operation: version.effect.operation,
				cascade: version.effect.cascade,
				targetTurn: version.effect.targetTurn,
				...version.effect.blockKind === void 0 ? {} : { blockKind: version.effect.blockKind },
				...version.effect.before === void 0 ? {} : { before: version.effect.before },
				...version.effect.after === void 0 ? {} : { after: version.effect.after }
			}
		};
	});
	const effectIds = /* @__PURE__ */ new Set();
	for (const version of versions) {
		if (version.effectId === void 0) continue;
		if (effectIds.has(version.effectId)) throw new Error(`版本效果 ${version.effectId} 重复。`);
		effectIds.add(version.effectId);
	}
	const versionsById = new Map(versions.map((version) => [version.sessionId, version]));
	const undoStack = [];
	let undoCursor = versionsById.get(sessionId);
	while (undoCursor?.inverseSessionId !== void 0) {
		const inverseId = undoCursor.inverseSessionId;
		if (undoStack.includes(inverseId)) throw new Error("版本效果逆链包含循环。");
		if (!versionsById.has(inverseId)) throw new Error(`恢复目标 ${inverseId} 不在可见版本树中。`);
		undoStack.push(inverseId);
		undoCursor = versionsById.get(inverseId);
	}
	const redoSessionIds = versions.filter((version) => version.inverseSessionId === sessionId).map((version) => version.sessionId);
	const currentIndex = versions.findIndex((version) => version.current);
	const currentLog = logs[currentIndex];
	if (currentIndex < 0 || currentLog === void 0) throw new Error("当前版本不在版本树中。");
	const turns = closedTurns(currentLog);
	return {
		sessionId,
		messages: editableMessages(turns),
		retryableTurns: retryableTurns(turns),
		versions,
		undoStack,
		redoSessionIds
	};
}
function objectValue(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("请求体必须是 JSON 对象。");
	return value;
}
function sessionIdOf(value) {
	if (typeof value !== "string" || value.length === 0) throw new TypeError("sessionId 必须是非空字符串。");
	return value;
}
function integerOf(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} 必须是非负安全整数。`);
	return value;
}
function cascadeOf(value) {
	if (value !== "truncate" && value !== "preserve") throw new TypeError("cascade 必须是 truncate 或 preserve。");
	return value;
}
function decodeOperation(value) {
	const record = objectValue(value);
	const sessionId = sessionIdOf(record["sessionId"]);
	switch (record["action"]) {
		case "edit":
			if (typeof record["text"] !== "string") throw new TypeError("text 必须是字符串。");
			return {
				action: "edit",
				sessionId,
				eventSeq: integerOf(record["eventSeq"], "eventSeq"),
				blockIndex: integerOf(record["blockIndex"], "blockIndex"),
				text: record["text"],
				cascade: cascadeOf(record["cascade"])
			};
		case "reroll": return {
			action: "reroll",
			sessionId
		};
		case "retry": return {
			action: "retry",
			sessionId,
			turn: integerOf(record["turn"], "turn"),
			cascade: cascadeOf(record["cascade"])
		};
		default: throw new TypeError("action 必须是 edit、reroll 或 retry。");
	}
}
function requestJson(request) {
	return new Promise((resolve, reject) => {
		const decoder = new TextDecoder();
		let text = "";
		request.on("data", (chunk) => {
			text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
		});
		request.on("end", () => {
			try {
				text += decoder.decode();
				resolve(JSON.parse(text));
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}
function respondJson(response, status, value) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	response.end(JSON.stringify(value));
}
async function handleRoute(ctx, request, response) {
	try {
		if (request.method === "GET") {
			respondJson(response, 200, await timeline(ctx, sessionIdOf(new URL(request.url ?? "/message-edit", "http://message-edit.local").searchParams.get("sessionId"))));
			return;
		}
		if (request.method === "POST") {
			respondJson(response, 200, await runOperation(ctx, decodeOperation(await requestJson(request))));
			return;
		}
		response.writeHead(405);
		response.end();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		respondJson(response, error instanceof TypeError ? 400 : 409, { error: message });
	}
}
/** Register the reversible route contribution. */
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: MESSAGE_EDIT_PATH,
		handler: (request, response) => handleRoute(ctx, request, response)
	}), "message-edit: HTTP route");
}
//#endregion
export { MESSAGE_EDIT_PATH, MESSAGE_EDIT_VERSION_SCHEMA, MESSAGE_EDIT_VIEW_ORDER, apply, inject, name };
