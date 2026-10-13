import type { OptimizeResponse } from "./types.js";

export const METHOD_GROUPS = [
  "理清问题",
  "学习与研究",
  "解决问题",
  "辅助决策",
  "个人探索",
] as const;
export type ThinkingMethod = {
  id: string;
  name: string;
  group: (typeof METHOD_GROUPS)[number];
  description: string;
  zh: string;
  en: string;
};

export const THINKING_METHODS: readonly ThinkingMethod[] = [
  {
    id: "socratic",
    name: "苏格拉底式提问",
    group: "理清问题",
    description: "通过关键追问明确真正的问题。",
    zh: "请通过苏格拉底式提问帮助我明确真正的问题。每次只问一个可能改变判断的问题，根据回答继续，包含追问在内最多 6 个问题，信息足够时立即停止。区分事实、解释、价值判断与目标，检查含糊概念、默认前提、证据和其他解释。每次继续提问前简短说明更新的判断。结束后整理原始问题、真正目标、已确认事实、未验证假设和关键变量，提出一个准确且可行动的新问题。等我确认后再给出建议。",
    en: "Help clarify the real problem through Socratic questioning. Ask one decision-relevant question at a time and adapt to each answer; limit all questions, including follow-ups, to 6 and stop earlier when sufficient. Distinguish facts, interpretations, values and goals; examine ambiguous terms, assumptions, evidence and alternative explanations. Briefly state what changed before the next question. At the end, identify the initial question, actual goal, confirmed facts, untested assumptions and key variables. Propose a precise actionable question, then wait for my confirmation before advice.",
  },
  {
    id: "dual-layer",
    name: "双层解释",
    group: "学习与研究",
    description: "从生活例子理解专业机制。",
    zh: "请分两层解释我提供的概念或问题。入门层使用通俗语言和具体生活例子，专业层使用准确术语说明核心机制、适用边界、使用代价与常见误解。指出类比的局限，列出通俗说法与专业术语的对应关系，并给出 3 个理解检查问题。依据主题复杂度安排篇幅。",
    en: "Explain the supplied concept or problem in two layers. Start with accessible language and a concrete everyday example; then use precise terminology to explain the mechanism, boundaries, costs and common misconceptions. State where the analogy breaks down, map plain-language ideas to technical terms, and include 3 comprehension questions. Use a length proportionate to the topic.",
  },
  {
    id: "reverse",
    name: "反向拆解",
    group: "学习与研究",
    description: "学习优秀作品的关键选择。",
    zh: "请拆解我提供的作品、产品或方案，说明它服务谁、解决什么问题，以及结构、流程、关键选择和完成标准如何共同发挥作用。区分可以迁移的规律与案例专属条件，提炼 3–5 条有依据的可复用规律、操作清单和一个练习。只分析能够获取的材料，缺失内容明确说明并请求必要资料。",
    en: "Reverse-engineer the supplied work, product or proposal. Explain its audience and problem, and how structure, workflow, key choices and completion criteria contribute. Distinguish transferable principles from case-specific conditions. Derive 3–5 evidence-based principles, an action checklist and one practice exercise. Analyze only accessible material; disclose missing information and request essential source material.",
  },
  {
    id: "axes",
    name: "横纵分析",
    group: "学习与研究",
    description: "研究发展过程与同类差异。",
    zh: "请从纵向发展和横向比较研究我提供的对象。纵向梳理背景、关键转折、成功与失败及早期选择的影响；横向说明比较对象的选择理由，以统一维度分析优势、限制和适用情境。结合两者讨论可能的发展路径、成立条件和预警信号。优先使用一手来源，重要结论标注来源与日期，分开事实、推断和观点；证据不足标为待核实。无法联网时明确研究范围。",
    en: "Study the supplied subject through historical development and peer comparison. Trace its origins, turning points, successes, failures and the effects of early choices. Justify peer selection and compare strengths, limitations and contexts using consistent dimensions. Connect both axes to plausible future paths, conditions and warning signs. Prefer primary sources, cite sources and dates near key claims, and distinguish facts, inferences and opinions. Label insufficient evidence as unverified; disclose scope when browsing is unavailable.",
  },
  {
    id: "fact-check",
    name: "事实核查",
    group: "学习与研究",
    description: "检查证据、来源与推理。",
    zh: "请将我提供的说法拆分为可验证事实、推理结论与价值判断。核查来源、样本、时间和上下文，将事实标为已证实、需要限定、存在争议、证据不足或错误，并提供支持各项判断的来源。检查隐藏假设、因果与相关的混淆、其他解释及结论的适用条件。给出需要修正的内容、关键推理缺口和证据支持的改写。无法获取来源时明确说明，避免虚构核查结果。",
    en: "Separate the supplied claims into verifiable facts, inferred conclusions and value judgments. Check source, sample, date and context; classify facts as verified, qualified, disputed, insufficiently evidenced or incorrect, with supporting sources. Examine hidden assumptions, causal versus correlational claims, alternative explanations and conditions. Identify corrections and reasoning gaps, then provide an evidence-supported revision. If sources are inaccessible, say so without inventing verification results.",
  },
  {
    id: "perspectives",
    name: "多视角分析",
    group: "解决问题",
    description: "从互补的专业视角分析问题。",
    zh: "请选择 3 种与我的问题相关且互补的专业视角，并说明选择理由。分别分析问题定义、可行路径、容易遗漏的风险和会改变判断的新证据。比较它们的共同事实、分歧及背后假设，再提出综合方案、适用条件、最大风险、退出条件和下一步行动。避免模仿真实人物或虚构专家经历；信息不足时只询问最关键的缺项。",
    en: "Choose 3 relevant, complementary professional perspectives and explain why each matters. For each, examine the problem definition, viable paths, overlooked risks and evidence that would change the assessment. Compare shared facts, disagreements and underlying assumptions. Provide an integrated proposal, conditions, major risk, exit criteria and next action. Do not impersonate real people or invent credentials; ask only for critical missing information.",
  },
  {
    id: "first-principles",
    name: "第一性原理",
    group: "解决问题",
    description: "从基本事实与目标推导方案。",
    zh: "请区分我的问题中已确认的基本事实、未经验证的假设、真正目标以及现实资源与限制。检查惯例和已有方案的必要性，从事实、目标与限制重新推导可行路径。说明哪些原有做法只处理表面、候选路径的成立前提、取舍与风险，以及验证关键假设的下一步。保持事实边界，避免把假设当成确定条件。",
    en: "Separate confirmed fundamentals, untested assumptions, the actual goal, and practical resources and constraints. Examine whether conventions and existing solutions are necessary, then derive viable paths from facts, goals and constraints. Identify surface-level fixes, prerequisites, trade-offs, risks and the next step to validate the key assumption. Keep assumptions distinct from established facts.",
  },
  {
    id: "cross-domain",
    name: "跨领域借鉴",
    group: "解决问题",
    description: "借用其他领域的解决机制。",
    zh: "请先抽象我的问题的基本结构、核心矛盾和已有解法失效的原因，再寻找 3 个不同领域中有证据支持的相似机制。逐项说明原问题、解决机制、相似点、可迁移部分、迁移成本和失效条件，避免仅凭表面相似建立类比。将有价值的机制转为符合当前限制的方案，并设计一个低成本、可逆的验证实验。案例不确定时标明待核实。",
    en: "Abstract the underlying structure, central tension and reasons existing solutions fail. Find evidence-supported analogous mechanisms in 3 different domains. For each, explain the original problem, mechanism, similarities, transferable parts, costs and failure conditions; avoid superficial analogies. Translate useful mechanisms into options compatible with current constraints and propose a low-cost reversible validation experiment. Label uncertain cases as unverified.",
  },
  {
    id: "two-sided",
    name: "双向论证",
    group: "辅助决策",
    description: "检查不同选择的理由与条件。",
    zh: "请准确重述我需要做出的选择，分别为已有选项提出最有力的支持理由、适用条件、收益、风险和反对意见。找出真正分歧、可能改变结论的变量及缺失信息，避免默认偏向某个选项。若仍缺少决定性信息，只问一个最可能改变判断的问题；信息足够后说明推荐选择、理由、适用条件与下一步行动。保留用户决定权。",
    en: "Restate the actual decision and give the strongest case for each supplied option, including conditions, benefits, risks and objections. Identify real disagreements, decision-changing variables and missing evidence without favoring an option by default. If decisive information is missing, ask one question most likely to change the assessment. Once sufficient, recommend a choice with reasons, conditions and the next action while preserving my agency.",
  },
  {
    id: "experiment",
    name: "实验设计",
    group: "辅助决策",
    description: "用可执行实验验证关键假设。",
    zh: "请识别我的选择或想法背后最需要验证的假设，选出最可能改变判断的一项，并设计低成本、可逆的实验。说明操作步骤、所需时间与资源、观察指标、继续与停止条件及能够获得的新信息，提出一个可以开始的具体动作。期限、预算与指标阈值以我提供的信息为准；缺失时提出需要确认的选项，避免自行设定为事实。",
    en: "Identify the assumptions most in need of testing and select the one most likely to change the decision. Design a low-cost reversible experiment with steps, required time and resources, observations, continuation and stopping criteria, and expected new information. Give a concrete starting action. Use my supplied deadlines, budget and thresholds; when absent, propose choices for confirmation rather than asserting invented values.",
  },
  {
    id: "strengths",
    name: "经历与优势复盘",
    group: "个人探索",
    description: "从具体经历识别能力与偏好。",
    zh: "请通过具体经历帮助我识别能力、兴趣、偏好与消耗。每次只问一个问题，包含追问在内最多 10 个，信息足够时停止，允许我跳过不愿讨论的内容。关注主动投入的事情、容易完成的任务、投入后的能量变化与羡慕的生活方式。每项判断对应我提供的经历，证据不足时保留不确定性，不使用心理诊断或固定人格标签。整理能力线索、适合的环境、现实限制和可尝试的验证行动。",
    en: "Use concrete experiences to explore abilities, interests, preferences and energy costs. Ask one question at a time, no more than 10 including follow-ups; stop when sufficient and let me skip private topics. Explore self-motivated activities, naturally manageable tasks, energy changes and admired lifestyles. Ground every observation in supplied experiences, retain uncertainty, and avoid psychological diagnoses or fixed personality labels. Organize ability clues, suitable environments, practical constraints and validation actions.",
  },
  {
    id: "life-design",
    name: "人生设计",
    group: "个人探索",
    description: "梳理方向、约束与行动计划。",
    zh: "请帮助我梳理当前状态、价值取向、能量来源、资源与现实限制，区分可以改变的问题与需要接受的条件。每次只问一个关键问题，包含追问在内最多 9 个，允许跳过，信息足够时停止。根据我愿意考虑的方向提出相互独立、同样成立的生活路径，说明资源需求、喜欢程度、不确定性和代价。为有意愿的方向设计可逆的体验或对谈及近期行动，保留我的选择权，避免制造焦虑或作心理诊断。",
    en: "Help clarify my current situation, values, sources of energy, resources and constraints; distinguish changeable problems from conditions to accept. Ask one key question at a time, at most 9 including follow-ups, allow skipping, and stop when sufficient. Develop independent, viable life paths I would genuinely consider, with resource needs, appeal, uncertainty and costs. Design reversible experiences or conversations and near-term actions for preferred directions. Preserve my agency and avoid anxiety-inducing scenarios or psychological diagnoses.",
  },
];

export function requireThinkingMethod(id: unknown): ThinkingMethod {
  const method = THINKING_METHODS.find((entry) => entry.id === id);
  if (!method) throw new TypeError("思考方法无效，请重新选择。");
  return method;
}

export function generateThinkingPrompt(
  input: unknown,
  methodId: unknown,
): OptimizeResponse {
  const method = requireThinkingMethod(methodId);
  if (typeof input !== "string") throw new TypeError("input 必须是字符串。");
  if (input.length > 10_000)
    throw new RangeError("思考方法正文不能超过 10000 个字符。");
  const source = input.trim() ? input : "";
  const start = performance.now();
  const chinese = !source || /[\p{Script=Han}]/u.test(source);
  const instruction = chinese ? method.zh : method.en;
  const rule = chinese
    ? "保留我的语言、事实、数字、路径、代码及占位符。缺失信息明确指出，篇幅与问题相称，不编造背景、人员、期限或指标。"
    : "Preserve my language, facts, numbers, paths, code and placeholders. Explicitly identify missing information, use proportionate detail, and do not invent context, people, deadlines or metrics.";
  const context = source
    ? `${chinese ? "我的问题与背景：" : "My question and context:"}\n${source}`
    : "请先询问我希望讨论的问题或材料，再使用上述方法。";
  const optimized = `${instruction}\n\n${rule}\n\n${context}`;
  if (optimized.length > 10_000)
    throw new RangeError("组合后的提示词不能超过 10000 个字符，请缩短正文。");
  return {
    optimized,
    metrics: {
      inputChars: source.length,
      outputChars: optimized.length,
      expansionRatio: source.length
        ? Number((optimized.length / source.length).toFixed(2))
        : null,
      durationMs: Math.round(performance.now() - start),
      tokenUsage: null,
    },
    traceId: `local:${method.id}`,
  };
}
