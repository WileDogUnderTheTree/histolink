/**
 * 自动生成，禁止手改（scripts/gen-frontend-types.mjs）。
 *
 * 来源：contracts/api-v1.openapi.json（由 backend/contracts 的 Pydantic 模型导出）
 * 重新生成：node scripts/gen-frontend-types.mjs
 * 校验：node scripts/gen-frontend-types.mjs --check
 */
export interface paths {
    "/api/agent/ask": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ask */
        post: operations["ask_api_agent_ask_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/ping_llm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Ping Llm */
        get: operations["ping_llm_api_agent_ping_llm_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/entities/event/{event_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Event */
        get: operations["get_event_api_entities_event__event_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/entities/person/{person_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Person */
        get: operations["get_person_api_entities_person__person_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/entities/persons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Find Persons */
        get: operations["find_persons_api_entities_persons_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Meta */
        get: operations["meta_api_meta_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search Events */
        get: operations["search_events_api_search_events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Answer */
        Answer: {
            /** Certainty */
            certainty?: ("high" | "medium" | "low") | null;
            /** Claims */
            claims?: components["schemas"]["Claim"][];
            /** Markdown */
            markdown: string;
            /** Missing */
            missing?: string[];
            mode: components["schemas"]["AnswerMode"];
            /** Reason Code */
            reason_code?: ("OUT_OF_SCOPE" | "UNSAFE_REQUEST" | "NO_RELIABLE_BASIS") | null;
            /** Related Event Ids */
            related_event_ids?: string[];
        };
        /**
         * AnswerEnvelope
         * @description 成功响应；`answer` 与 `clarification` 恰好一个非空。
         */
        AnswerEnvelope: {
            answer?: components["schemas"]["Answer"] | null;
            /** Citations */
            citations?: components["schemas"]["Citation"][];
            clarification?: components["schemas"]["Clarification"] | null;
            /** Entities */
            entities?: components["schemas"]["Entity"][];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            ok: "true";
            /** Request Id */
            request_id: string;
            /**
             * Schema Version
             * @default 1.0
             * @constant
             */
            schema_version: "1.0";
            snapshot: components["schemas"]["SnapshotMeta"];
            trace?: components["schemas"]["Trace"] | null;
            /** Ui Actions */
            ui_actions?: components["schemas"]["UIAction"][];
        };
        /**
         * AnswerMode
         * @description Q4：三态回答。
         * @enum {string}
         */
        AnswerMode: "grounded" | "insufficient" | "refusal";
        /** ApiEvent */
        ApiEvent: {
            /** Description */
            description: string;
            /** Dynasty */
            dynasty: string;
            /** Event Id */
            event_id: string;
            /** Importance */
            importance?: number | null;
            /**
             * Is Special
             * @default false
             */
            is_special: boolean;
            /** Person Ids */
            person_ids?: string[];
            /** Source Refs */
            source_refs?: components["schemas"]["SourceRefModel"][];
            /**
             * Source Status
             * @default cited
             * @enum {string}
             */
            source_status: "cited" | "easter_egg";
            surface: components["schemas"]["EventSurface"];
            /** Title */
            title: string;
            /** Year */
            year: number;
        };
        /** ApiPerson */
        ApiPerson: {
            /** Aliases */
            aliases?: string[];
            /** Disambiguator */
            disambiguator: string;
            /** Display Name */
            display_name: string;
            /** Dynasties */
            dynasties?: string[];
            /** Era Ids */
            era_ids?: string[];
            /** Events */
            events?: components["schemas"]["EventSummary"][];
            /** First Year */
            first_year: number;
            /** Last Year */
            last_year: number;
            /** Person Id */
            person_id: string;
            /** Primary Dynasty */
            primary_dynasty: string;
            /** Romanized */
            romanized: string;
            /** Scope Ids */
            scope_ids?: string[];
        };
        /**
         * AskContext
         * @description 页面上下文；服务端只据此做实体收敛与动作判定，不据此渲染。
         */
        AskContext: {
            /** Dynasty */
            dynasty?: string | null;
            /** Era Id */
            era_id?: string | null;
            /** Event Id */
            event_id?: string | null;
            mode?: components["schemas"]["AskMode"] | null;
            /** Person Id */
            person_id?: string | null;
            /**
             * Route
             * @description 当前页面路由，例如 /timeline；Q1 的深链接与 Q5 的实体收敛都依赖它。
             */
            route: string;
        };
        /**
         * AskMode
         * @description 当前页面模式（由前端按视图推导后放入 context）。
         * @enum {string}
         */
        AskMode: "browse" | "detail" | "compare";
        /**
         * AskRequest
         * @description POST /api/agent/ask 的请求体。
         */
        AskRequest: {
            /** Clarification Id */
            clarification_id?: string | null;
            /**
             * Client Schema Version
             * @default 1.0
             * @constant
             */
            client_schema_version: "1.0";
            context: components["schemas"]["AskContext"];
            /** History */
            history?: components["schemas"]["ConversationTurn"][];
            /** Question */
            question: string;
            /** Selected Person Id */
            selected_person_id?: string | null;
            /** Session Id */
            session_id: string;
        };
        /** Capabilities */
        Capabilities: {
            /** Actions */
            actions?: components["schemas"]["UIActionType"][];
            /**
             * Clarification
             * @default true
             */
            clarification: boolean;
        };
        /**
         * Citation
         * @description 引用条目；Q6 要求每条都带 attribution 与 license。
         *
         *     V1.0.5 起新增可选 ``kind="rag"``（RAG 史料 chunk）与 ``record_type``：
         *     - ``id`` 即 RAG chunk_id；``event_id`` 为对齐到的图谱事件（可能为空）；
         *     - ``quote`` 为 chunk 正文（工具层已截断到 ≤300 字）；
         *     - ``record_type`` 区分「正史 / 传说」，供前端与 Agent 标注 ``[传说]``；
         *     - 对既有 event / relation / person 引用完全向后兼容（新增字段均可选）。
         */
        Citation: {
            /** Attribution */
            attribution: string;
            /** Dynasty */
            dynasty?: string | null;
            /** Event Id */
            event_id?: string | null;
            /** Id */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "event" | "relation" | "person" | "rag";
            /**
             * License
             * @default CC BY-NC-SA 4.0
             * @constant
             */
            license: "CC BY-NC-SA 4.0";
            /** Person Id */
            person_id?: string | null;
            /** Quote */
            quote?: string | null;
            /** Record Type */
            record_type?: ("正史" | "传说") | null;
            /** Relation Id */
            relation_id?: string | null;
            /** Source Label */
            source_label?: string | null;
            source_ref?: components["schemas"]["SourceRefModel"] | null;
            /** Title */
            title: string;
            /** Year */
            year?: number | null;
        };
        /**
         * Claim
         * @description 回答中的单条事实陈述；grounded 模式下必须绑定引用。
         */
        Claim: {
            /** Citation Ids */
            citation_ids: string[];
            /** Id */
            id: string;
            /** Text */
            text: string;
        };
        /** Clarification */
        Clarification: {
            /** Candidates */
            candidates: components["schemas"]["ClarificationCandidate"][];
            /** Id */
            id: string;
            /** Question */
            question: string;
            /**
             * Type
             * @default entity
             * @constant
             */
            type: "entity";
        };
        /**
         * ClarificationCandidate
         * @description Q5 候选；前端不得默认选中第一条。
         */
        ClarificationCandidate: {
            /** Disambiguator */
            disambiguator: string;
            /** Era Ids */
            era_ids?: string[];
            /** Hint */
            hint?: string | null;
            /** Name */
            name: string;
            /** Person Id */
            person_id: string;
        };
        /** ConversationTurn */
        ConversationTurn: {
            /** Content */
            content: string;
            /**
             * Role
             * @enum {string}
             */
            role: "user" | "assistant";
        };
        /** Entity */
        Entity: {
            /** Disambiguator */
            disambiguator?: string | null;
            /** Era Ids */
            era_ids?: string[];
            /** Event Id */
            event_id?: string | null;
            /**
             * Kind
             * @enum {string}
             */
            kind: "person" | "event" | "relation";
            /** Name */
            name?: string | null;
            /** Person Id */
            person_id?: string | null;
            /** Title */
            title?: string | null;
        };
        /**
         * ErrorCode
         * @description 冻结错误码（审核报告 §5.7 + TC-06 只读 API 层补充）。
         * @enum {string}
         */
        ErrorCode: "ENTITY_NOT_FOUND" | "AMBIGUOUS_ENTITY" | "INSUFFICIENT_EVIDENCE" | "OUT_OF_SCOPE" | "LLM_TIMEOUT" | "SNAPSHOT_MISMATCH" | "INTERNAL" | "INVALID_REQUEST" | "METHOD_NOT_ALLOWED" | "ROUTE_NOT_FOUND" | "SNAPSHOT_NOT_LOADED" | "LLM_NOT_CONFIGURED" | "LLM_UPSTREAM_ERROR";
        /** ErrorEnvelope */
        ErrorEnvelope: {
            error: components["schemas"]["ErrorInfo"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            ok: "false";
            /** Request Id */
            request_id: string;
        };
        /** ErrorInfo */
        ErrorInfo: {
            code: components["schemas"]["ErrorCode"];
            /** Details */
            details?: {
                [key: string]: unknown;
            } | null;
            /** Message */
            message: string;
            /**
             * Retryable
             * @default false
             */
            retryable: boolean;
        };
        /** EventResponse */
        EventResponse: {
            event: components["schemas"]["ApiEvent"];
            /**
             * Ok
             * @default true
             * @constant
             */
            ok: true;
            /**
             * Schema Version
             * @default 1.0
             * @constant
             */
            schema_version: "1.0";
            snapshot: components["schemas"]["SnapshotMeta"];
        };
        /** EventSearchResponse */
        EventSearchResponse: {
            /**
             * Ok
             * @default true
             * @constant
             */
            ok: true;
            /** Query */
            query: string;
            /** Results */
            results?: components["schemas"]["ApiEvent"][];
            /**
             * Schema Version
             * @default 1.0
             * @constant
             */
            schema_version: "1.0";
            snapshot: components["schemas"]["SnapshotMeta"];
        };
        /** EventSummary */
        EventSummary: {
            /** Dynasty */
            dynasty: string;
            /** Event Id */
            event_id: string;
            /** Importance */
            importance?: number | null;
            /** Title */
            title: string;
            /** Year */
            year: number;
        };
        /** EventSurface */
        EventSurface: {
            /** Graph */
            graph: boolean;
            /** Timeline */
            timeline: boolean;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HealthResponse */
        HealthResponse: {
            /**
             * Ok
             * @default true
             * @constant
             */
            ok: true;
            /**
             * Version
             * @default 1.0.5.1
             */
            version: string;
        };
        /** MetaCounts */
        MetaCounts: {
            /** Aliases */
            aliases: number;
            /** Eras */
            eras: number;
            /** Events */
            events: number;
            /** Groups */
            groups: number;
            /** Persons */
            persons: number;
            /** Relations */
            relations: number;
            /** Scopes */
            scopes: number;
        };
        /** MetaResponse */
        MetaResponse: {
            /**
             * Api Version
             * @default 1.0.5.1
             */
            api_version: string;
            capabilities: components["schemas"]["Capabilities"];
            /**
             * Ok
             * @default true
             * @constant
             */
            ok: true;
            /**
             * Schema Version
             * @default 1.0
             * @constant
             */
            schema_version: "1.0";
            snapshot: components["schemas"]["MetaSnapshot"];
        };
        /** MetaSnapshot */
        MetaSnapshot: {
            counts: components["schemas"]["MetaCounts"];
            /** Hash */
            hash: string;
            /** Version */
            version: string;
        };
        /** PersonCandidate */
        PersonCandidate: {
            /** Disambiguator */
            disambiguator: string;
            /** Display Name */
            display_name: string;
            /** Era Ids */
            era_ids?: string[];
            /** Hint */
            hint?: string | null;
            /** Person Id */
            person_id: string;
            /** Primary Dynasty */
            primary_dynasty: string;
        };
        /** PersonCandidatesResponse */
        PersonCandidatesResponse: {
            /** Candidates */
            candidates?: components["schemas"]["PersonCandidate"][];
            /**
             * Ok
             * @default true
             * @constant
             */
            ok: true;
            /** Query */
            query: string;
            /**
             * Schema Version
             * @default 1.0
             * @constant
             */
            schema_version: "1.0";
            snapshot: components["schemas"]["SnapshotMeta"];
        };
        /** PersonResponse */
        PersonResponse: {
            /**
             * Ok
             * @default true
             * @constant
             */
            ok: true;
            person: components["schemas"]["ApiPerson"];
            /**
             * Schema Version
             * @default 1.0
             * @constant
             */
            schema_version: "1.0";
            snapshot: components["schemas"]["SnapshotMeta"];
        };
        /**
         * PingLLMResponse
         * @description LLM 连通性探测结果（TC-10）：只用于验证网关/模型可用性，不进入问答链路。
         */
        PingLLMResponse: {
            /**
             * Latency Ms
             * @description 端到端耗时（毫秒）
             */
            latency_ms: number;
            /**
             * Message
             * @description 发给模型的测试语句
             */
            message: string;
            /**
             * Model
             * @description 实际使用的模型名
             */
            model: string;
            /**
             * Ok
             * @default true
             * @constant
             */
            ok: true;
            /**
             * Reply
             * @description 模型真实回复
             */
            reply: string;
            /**
             * Usage
             * @description 上游返回的 token 用量（若有）
             */
            usage?: {
                [key: string]: number;
            } | null;
        };
        /**
         * SnapshotMeta
         * @description 回答里携带的快照版本；前端据此判断是否降级为纯文字。
         */
        SnapshotMeta: {
            /** Events */
            events?: number | null;
            /** Hash */
            hash: string;
            /** Persons */
            persons?: number | null;
            /** Version */
            version: string;
        };
        /**
         * SourceRefModel
         * @description 结构化引用（与 frontend/data/source-types.ts 对齐）。
         */
        SourceRefModel: {
            /** Book */
            book: string;
            /** Chapter */
            chapter?: string | null;
            /** Label */
            label: string;
            /** Raw */
            raw: string;
        };
        /** ToolTrace */
        ToolTrace: {
            /** Args */
            args?: {
                [key: string]: unknown;
            };
            /** Hits */
            hits?: number | null;
            /** Ms */
            ms?: number | null;
            /** Name */
            name: string;
        };
        /** Trace */
        Trace: {
            /** Latency Ms */
            latency_ms?: number | null;
            /** Model */
            model?: string | null;
            /** Model Used */
            model_used?: string | null;
            /** Tools */
            tools?: components["schemas"]["ToolTrace"][];
        };
        /**
         * UIAction
         * @description 动作信封（冻结字段：id/type/payload/target/auto/label/reason）。
         */
        UIAction: {
            /**
             * Auto
             * @description 仅建议值；跨页由前端强制覆盖为需确认
             * @default false
             */
            auto: boolean;
            /**
             * Id
             * @description 幂等键：同一次 request_id 内只执行一次
             */
            id: string;
            /** Label */
            label: string;
            /** Payload */
            payload?: {
                [key: string]: unknown;
            };
            /** Reason */
            reason?: string | null;
            target: components["schemas"]["UIActionTarget"];
            type: components["schemas"]["UIActionType"];
        };
        /**
         * UIActionTarget
         * @description 动作目标；前端据此判定同页 / 跨页（Q2），不信任后端 auto。
         */
        UIActionTarget: {
            /** Params */
            params?: {
                [key: string]: string | number | boolean | null;
            };
            surface: components["schemas"]["UISurface"];
        };
        /**
         * UIActionType
         * @description 动作类型枚举（V1.0 冻结）。
         * @enum {string}
         */
        UIActionType: "timeline.focus_event" | "timeline.focus_dynasty" | "graph.focus_person" | "graph.focus_relation" | "ask.suggest" | "timeline.highlight_events" | "graph.highlight_persons" | "open.event_card" | "open.person_card";
        /**
         * UISurface
         * @description 动作目标界面；V1.0 只允许这三个。
         * @enum {string}
         */
        UISurface: "timeline" | "graph" | "ask";
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    ask_api_agent_ask_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AskRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnswerEnvelope"] | components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    ping_llm_api_agent_ping_llm_get: {
        parameters: {
            query?: {
                message?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PingLLMResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Bad Gateway */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Gateway Timeout */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    get_event_api_entities_event__event_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                event_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventResponse"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    get_person_api_entities_person__person_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                person_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonResponse"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    find_persons_api_entities_persons_get: {
        parameters: {
            query: {
                name: string;
                era_id?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonCandidatesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    meta_api_meta_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetaResponse"];
                };
            };
        };
    };
    search_events_api_search_events_get: {
        parameters: {
            query: {
                q: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventSearchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
}
