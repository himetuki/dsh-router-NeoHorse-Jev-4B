/**
 * Tier chip — browser half of `dsh-router-neohorse` (adapted from dsh-router-laya; the judge is now
 * the TokenRhythm NeoHorse-Jev-4B decision call).
 *
 * Packaged as the client module system's lazy-CJS bundle: executing this file only REGISTERS a factory,
 * the module body runs at first materialization, and every side effect (including the stylesheet) lives
 * inside the factory closure. `require("react")` resolves against the shell's frozen platform seed.
 *
 * All colours, sizes, copy and timings are the spec's, copied verbatim; the two places where the spec's
 * literal value cannot be used as written are marked ADAPTED below with the reason.
 */
window.__ModuleLoader__.load({
  id: "dsh-router-neohorse",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    const React = require("react")

    // ── spec §2/§3/§4/§5 constants ────────────────────────────────────────────────────────────────
    // The judgment history is served same-origin by the host half (the remote judge keeps no local
    // service), like the mode switch below.
    const STATE_URL = "/router-neohorse/state"
    // Same-origin, unlike /state: a static client bundle has no `host.call` and no `ctx.remote.settings`,
    // so the host half serves this route to read and switch the mode.
    const MODE_URL = "/router-neohorse/mode"
    const POLL_MS = 3000
    const POLL_FAILURES_BEFORE_OFFLINE = 2
    const TOAST_MS = 2000
    const TOAST_GAP_PX = 8
    const HOVER_SHOW_MS = 300
    const HOVER_HIDE_MS = 150
    const POPOVER_LIMIT = 20
    const TASK_CHARS = 30

    const TIER_ORDER = { low: 0, high: 1, max: 2 }
    const TIER_COLOR = { low: "#3fb950", high: "#d29922", max: "#f85149" }
    const TIER_TEXT = { low: "AUTO · 低", high: "AUTO · 高", max: "AUTO · MAX" }
    const TIER_SHORT = { low: "低", high: "高", max: "MAX" }
    const OFFLINE_COLOR = "#8b949e"
    const OFFLINE_TEXT = "AUTO · 离线"
    const OFFLINE_TIP = "判定不可用 · 已落 low（检查网络与基元律动凭据）"
    // The spec's five states do not cover "the service is healthy but nothing has been judged yet", which
    // is the real state on every fresh load: /state's log is in-memory and empty until this session's
    // first turn is judged. Showing the offline copy there claims a failure that is not happening.
    const PENDING_TEXT = "AUTO · 待判定"
    const PENDING_TIP = "自动 · 等待本轮判定"
    const MANUAL_TEXT = "手动"

    const TOAST_TEXT = {
      escalate_regenerate: "⤴ 升档 · 检测到重试",
      intent_force: "⚡ 用户指定",
      intent_inherit: "↻ 保持上轮",
      intent_exclude: "按你的要求排除",
    }
    const REASON_TEXT = {
      neohorse: "NeoHorse 判断",
      escalate_regenerate: "检测到重试·升档",
      intent_force: "用户指定",
      intent_inherit: "保持上轮",
      intent_exclude: "用户排除",
    }

    const CSS = `
@keyframes routerLayaTierPop{0%{transform:scale(1)}40%{transform:scale(1.08)}100%{transform:scale(1)}}
@keyframes routerLayaBreathe{0%,100%{opacity:.85}50%{opacity:1}}
@keyframes routerLayaToastIn{0%{opacity:0;transform:translateY(4px)}100%{opacity:1;transform:translateY(0)}}
@keyframes routerLayaToastOut{0%{opacity:1}100%{opacity:0}}
.routerLayaChip{display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;
  user-select:none;box-sizing:border-box;background:transparent;
  transition:background-color .16s ease-out,border-color .16s ease-out,color .3s ease}
.routerLayaChip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.routerLayaDot{width:6px;height:6px;border-radius:999px;flex:none;transition:background-color .3s ease}
.routerLayaPop{animation:routerLayaTierPop 300ms ease-out}
.routerLayaMax{animation:routerLayaBreathe 2.4s ease-in-out infinite}
.routerLayaToast{position:absolute;bottom:calc(100% + ${TOAST_GAP_PX}px);right:0;white-space:nowrap;
  padding:4px 9px;border-radius:7px;font-size:11px;line-height:16px;pointer-events:none;
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-3,#fff));
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);
  box-shadow:0 6px 18px rgba(0,0,0,.14);animation:routerLayaToastIn .18s ease-out}
.routerLayaToastOut{animation:routerLayaToastOut .3s ease-in forwards}
.routerLayaPopover{position:absolute;bottom:calc(100% + 8px);right:0;width:330px;max-height:320px;
  overflow-y:auto;padding:6px;border-radius:9px;text-align:left;z-index:30;
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-3,#fff));
  border:1px solid var(--dsw-alias-border-l1);box-shadow:0 10px 28px rgba(0,0,0,.18)}
.routerLayaRow{display:flex;align-items:center;gap:7px;padding:3px 6px;border-radius:5px;font-size:11px;line-height:16px}
.routerLayaRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.routerLayaTime{opacity:.55;font-variant-numeric:tabular-nums;flex:none}
.routerLayaTask{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.routerLayaWhy{opacity:.6;flex:none}
.routerNeoTierEditor{font-size:12px;line-height:18px;text-align:left}
.routerNeoHint{opacity:.72;margin:0 0 8px}
.routerNeoTable{border-collapse:collapse;width:100%}
.routerNeoTable th{font-weight:600;opacity:.7;text-align:left;padding:3px 6px;font-size:11px}
.routerNeoTable td{padding:3px 6px;vertical-align:middle}
.routerNeoTable select{max-width:260px;width:100%;box-sizing:border-box;font-size:12px;padding:2px 4px;
  border-radius:6px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-3,transparent);color:var(--dsw-alias-label-primary)}
.routerNeoActions{display:flex;align-items:center;gap:8px;margin-top:10px}
.routerNeoButton{font-size:12px;padding:4px 10px;border-radius:7px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary)}
.routerNeoButton:disabled{opacity:.5;cursor:default}
.routerNeoStatus{opacity:.85}
.routerNeoError{color:#f85149}
`

    // ── shared poll state: server owns the truth (spec §6 constraint 2) ──────────────────────────
    const store = { data: null, offline: false, failures: 0, mode: null, listeners: new Set() }
    let poller = null
    let styleEl = null

    function notify() {
      for (const fn of Array.from(store.listeners)) {
        try { fn() } catch (error) { /* one bad subscriber must not stop the rest */ }
      }
    }

    function sessionsList() {
      const data = store.data
      if (data === null || typeof data !== "object" || data === null) return null
      const sessions = data.sessions
      return sessions !== null && typeof sessions === "object" ? sessions : null
    }

    /** Session match (spec §2): by id when known, otherwise the newest ts across all sessions. */
    function rowsFor(sessionId) {
      const sessions = sessionsList()
      if (sessions === null) return []
      if (sessionId !== undefined && sessionId !== null && Array.isArray(sessions[sessionId])) {
        return sessions[sessionId]
      }
      let best = null
      let bestTs = -Infinity
      for (const key of Object.keys(sessions)) {
        const rows = sessions[key]
        if (!Array.isArray(rows) || rows.length === 0) continue
        const tail = rows[rows.length - 1]
        const ts = tail !== undefined && typeof tail.ts === "number" ? tail.ts : -Infinity
        if (ts > bestTs) { bestTs = ts; best = rows }
      }
      return best === null ? [] : best
    }

    function pollOnce() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      fetch(STATE_URL, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("http " + String(res.status)))))
        .then((json) => {
          store.data = json
          store.failures = 0
          if (store.offline) store.offline = false
          notify()
        })
        .catch(() => {
          store.failures += 1
          if (store.failures >= POLL_FAILURES_BEFORE_OFFLINE && !store.offline) {
            store.offline = true
            notify()
          }
        })
      fetch(MODE_URL, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json !== null && (json.mode === "auto" || json.mode === "manual") && json.mode !== store.mode) {
            store.mode = json.mode
            notify()
          }
        })
        .catch(() => { /* the chip keeps its last known mode */ })
    }

    /** Switch mode; the response is authoritative, so a refused write cannot desync the chip. */
    function writeMode(next) {
      return fetch(MODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json !== null && (json.mode === "auto" || json.mode === "manual")) {
            store.mode = json.mode
            notify()
          }
        })
        .catch(() => { /* leave the displayed mode as it was */ })
    }

    function startPolling() {
      if (poller !== null) return
      pollOnce()
      poller = setInterval(pollOnce, POLL_MS)
    }

    // ── spec §4 toast copy ───────────────────────────────────────────────────────────────────────
    function toastText(triggeredBy, nextTier, prevTier) {
      if (Object.prototype.hasOwnProperty.call(TOAST_TEXT, triggeredBy)) return TOAST_TEXT[triggeredBy]
      if (triggeredBy === "neohorse") {
        const next = TIER_ORDER[nextTier]
        const prev = TIER_ORDER[prevTier]
        if (next === undefined || prev === undefined) return null
        if (next > prev) return "⤴ 升档 · 内容判断"
        if (next < prev) return "↩ 降回 · 新任务"
        return null
      }
      return null
    }

    function reasonText(triggeredBy) {
      return Object.prototype.hasOwnProperty.call(REASON_TEXT, triggeredBy)
        ? REASON_TEXT[triggeredBy]
        : String(triggeredBy === undefined || triggeredBy === null ? "" : triggeredBy)
    }

    function clockOf(ts) {
      if (typeof ts !== "number" || !isFinite(ts)) return "--:--"
      const d = new Date(ts * 1000)
      const hh = String(d.getHours()).padStart(2, "0")
      const mm = String(d.getMinutes()).padStart(2, "0")
      return hh + ":" + mm
    }

    function clip(text) {
      const s = typeof text === "string" ? text : ""
      return s.length > TASK_CHARS ? s.slice(0, TASK_CHARS) + "…" : s
    }

    // ── spec §3 geometry: sit beside the model selector, copying its own shape ───────────────────
    //
    // ADAPTED (1 of 2): the spec gives a literal `translateX(-8px)`. In this composer the chip's cell
    // renders BEFORE the model selector, so a negative offset moves it further away, not closer, and the
    // acceptance item it serves is "间距 8px" (spec §7.1). A fixed number cannot satisfy that because the
    // row's gap is not fixed, so the offset is measured: the chip is nudged by exactly
    // (current gap - 8px). The spec's intent -- an 8px gap -- is what is implemented.
    function measureGap(chipEl) {
      try {
        const effort = document.querySelector('[class*="triggerEffort"]')
        if (effort === null) return null
        const trigger = effort.closest("button") || effort.parentElement
        if (trigger === null) return null
        const chip = chipEl.getBoundingClientRect()
        const target = trigger.getBoundingClientRect()
        if (chip.width === 0 || target.width === 0) return null
        return { delta: target.left - chip.right - 8, trigger: trigger }
      } catch (error) {
        return null
      }
    }

    /** ADAPTED (2 of 2): "读它 computed style 复制" -- radius/height/font copied from the neighbour. */
    function copyNeighbourShape(trigger) {
      try {
        const cs = getComputedStyle(trigger)
        const shape = {}
        if (cs.borderRadius && cs.borderRadius !== "0px") shape.borderRadius = cs.borderRadius
        const h = parseFloat(cs.height)
        if (isFinite(h) && h >= 16 && h <= 40) shape.height = Math.round(h) + "px"
        const fs = parseFloat(cs.fontSize)
        if (isFinite(fs) && fs >= 10 && fs <= 18) shape.fontSize = Math.round(fs) + "px"
        return shape
      } catch (error) {
        return {}
      }
    }

    function useStore() {
      const tick = React.useState(0)
      React.useEffect(() => {
        startPolling()
        const fn = () => tick[1]((n) => n + 1)
        store.listeners.add(fn)
        return () => { store.listeners.delete(fn) }
      }, [])
      return store
    }

    function Chip(props) {
      const state = useStore()
      const chipRef = React.useState(null)
      const offset = React.useState(0)
      const shape = React.useState(null)
      const pop = React.useState(0)
      const toast = React.useState(null)
      const toastOut = React.useState(false)
      const popover = React.useState(false)
      const previous = React.useState(null)

      const sessionId = props === undefined || props === null ? undefined : props.sessionId
      const rows = rowsFor(sessionId)
      const latest = rows.length === 0 ? null : rows[rows.length - 1]
      const offline = state.offline
      const tier = latest !== null && typeof latest.tier === "string" ? latest.tier : null

      const manual = state.mode === "manual"

      // spec §4.3: first render is silent; only an adjacent-poll change on the same session animates.
      React.useEffect(() => {
        if (latest === null) return
        const prev = previous[0]
        previous[1]({ tier: latest.tier, triggeredBy: latest.triggered_by, sessionId: sessionId })
        if (prev === null) return
        if (prev.sessionId !== sessionId) return
        if (prev.tier === latest.tier) return
        pop[1]((n) => n + 1)
        const text = toastText(latest.triggered_by, latest.tier, prev.tier)
        if (text !== null) {
          toast[1](text)
          toastOut[1](false)
        }
      }, [latest === null ? null : latest.ts, sessionId])

      React.useEffect(() => {
        if (toast[0] === null) return undefined
        const hide = setTimeout(() => toastOut[1](true), TOAST_MS)
        const clear = setTimeout(() => { toast[1](null); toastOut[1](false) }, TOAST_MS + 320)
        return () => { clearTimeout(hide); clearTimeout(clear) }
      }, [toast[0]])

      // Geometry: measure once after layout settles, then keep the neighbour's shape.
      React.useEffect(() => {
        const node = chipRef[0]
        if (node === null) return undefined
        let raf = 0
        const apply = () => {
          const found = measureGap(node)
          if (found === null) return
          offset[1](found.delta)
          const copied = copyNeighbourShape(found.trigger)
          if (Object.keys(copied).length > 0) shape[1](copied)
        }
        raf = setTimeout(apply, 300)
        window.addEventListener("resize", apply)
        return () => { clearTimeout(raf); window.removeEventListener("resize", apply) }
      }, [props === undefined ? null : props.sessionId])

      // Hover timing per spec §5: 300ms to show, 150ms to hide.
      const hoverTimer = React.useState(null)
      const onEnter = () => {
        if (hoverTimer[0] !== null) clearTimeout(hoverTimer[0])
        hoverTimer[1](setTimeout(() => popover[1](true), HOVER_SHOW_MS))
      }
      const onLeave = () => {
        if (hoverTimer[0] !== null) clearTimeout(hoverTimer[0])
        hoverTimer[1](setTimeout(() => popover[1](false), HOVER_HIDE_MS))
      }
      React.useEffect(() => () => { if (hoverTimer[0] !== null) clearTimeout(hoverTimer[0]) }, [])

      // spec §3: manual shows 手动 with the pinned tier when one is known; colour returns to the default
      // foreground (no tier colour is painted in manual).
      const manualText = tier === null ? MANUAL_TEXT : MANUAL_TEXT + " · " + TIER_SHORT[tier]
      const nothingYet = !offline && tier === null
      const color = offline ? OFFLINE_COLOR : (manual || nothingYet ? null : TIER_COLOR[tier])
      const text = offline
        ? OFFLINE_TEXT
        : (manual ? manualText : (nothingYet ? PENDING_TEXT : TIER_TEXT[tier]))
      const title = offline
        ? OFFLINE_TIP
        : (manual ? "手动 · 点击恢复 Auto" : (nothingYet ? PENDING_TIP : "自动 · 点击切到手动"))

      const style = {
        height: "22px",
        padding: "0 9px",
        borderRadius: "999px",
        fontSize: "11px",
        lineHeight: "1",
        border: "1px solid var(--dsw-alias-border-l1)",
        color: offline || tier === null
          ? OFFLINE_COLOR
          : (manual ? "var(--dsw-alias-label-primary)" : color),
        fontWeight: manual ? 400 : 600,
        transform: "translateX(" + String(offset[0]) + "px)",
      }
      if (shape[0] !== null) {
        if (shape[0].height !== undefined) style.height = shape[0].height
        if (shape[0].borderRadius !== undefined) style.borderRadius = shape[0].borderRadius
        if (shape[0].fontSize !== undefined) style.fontSize = shape[0].fontSize
      }

      const dot = React.createElement("span", {
        className: "routerLayaDot",
        style: { background: color === null ? "var(--dsw-alias-label-dimmed)" : color },
      })

      const classes = ["routerLayaChip"]
      if (pop[0] !== 0) classes.push("routerLayaPop")
      if (!offline && !manual && tier === "max") classes.push("routerLayaMax")

      const chip = React.createElement("div", {
        ref: (node) => chipRef[1](node),
        className: classes.join(" "),
        style: style,
        title: title,
        onClick: () => { writeMode(manual ? "auto" : "manual") },
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
      }, dot, React.createElement("span", null, text))

      const toastNode = toast[0] === null
        ? null
        : React.createElement("div", {
            className: "routerLayaToast" + (toastOut[0] ? " routerLayaToastOut" : ""),
          }, toast[0])

      const popoverNode = popover[0] && rows.length > 0
        ? React.createElement("div", { className: "routerLayaPopover" },
            rows.slice(-POPOVER_LIMIT).reverse().map((row, index) => React.createElement("div", {
              key: String(row.ts) + ":" + String(index),
              className: "routerLayaRow",
            },
              React.createElement("span", { className: "routerLayaTime" }, clockOf(row.ts)),
              React.createElement("span", {
                className: "routerLayaDot",
                style: { background: TIER_COLOR[row.tier] || OFFLINE_COLOR },
              }),
              React.createElement("span", { className: "routerLayaTask" }, clip(row.task)),
              React.createElement("span", { className: "routerLayaWhy" },
                reasonText(row.triggered_by) + (row.regenerate === true ? " ↻" : "")),
            )))
        : null

      return React.createElement("div", {
        style: { position: "relative", display: "inline-flex", alignItems: "center" },
      }, chip, toastNode, popoverNode)
    }

    // ── plugin-page tier editor: provider / model / effort per tier ───────────────────────────────
    //
    // Registered into the plugin manager's `plugins.bundle.config` slot, keyed by the package name --
    // that key is what makes the manager treat this bundle as "configured" and render the section on
    // the plugin's page. A static client bundle has no `host.call`, so the data and the write both go
    // through the host half's same-origin routes.
    const CONFIG_URL = "/router-neohorse/config"
    const CATALOG_URL = "/router-neohorse/catalog"
    const PACKAGE_KEY = "dsh-router-neohorse"
    const TIER_ROWS = [
      { key: "low", label: "低档" },
      { key: "high", label: "高档" },
      { key: "max", label: "MAX" },
      { key: "fallback", label: "兜底" },
    ]
    const EMPTY_TIER = { provider: "", model: "", effort: "" }

    function tierOf(tiers, key) {
      const tier = tiers === null || typeof tiers !== "object" ? null : tiers[key]
      if (tier === null || typeof tier !== "object") return { provider: "", model: "", effort: "" }
      return { provider: tier.provider || "", model: tier.model || "", effort: tier.effort || "" }
    }

    /** The tiers the page saves: only rows naming both a provider and a model become overrides. */
    function savableTiers(tiers) {
      const out = {}
      for (const row of TIER_ROWS) {
        const tier = tierOf(tiers, row.key)
        if (tier.provider !== "" && tier.model !== "") {
          out[row.key] = { provider: tier.provider, model: tier.model, effort: tier.effort }
        }
      }
      return out
    }

    function optionList(entries, selected, placeholder) {
      const options = [React.createElement("option", { key: "", value: "" }, placeholder)]
      const ids = []
      for (const entry of entries) {
        ids.push(entry.id)
        options.push(React.createElement("option", { key: entry.id, value: entry.id },
          entry.name === entry.id ? entry.id : entry.name + "（" + entry.id + "）"))
      }
      if (selected !== "" && !ids.includes(selected)) {
        options.push(React.createElement("option", { key: selected, value: selected }, selected + "（当前值）"))
      }
      return options
    }

    function ConfigPage() {
      const [loading, setLoading] = React.useState(true)
      const [writable, setWritable] = React.useState(false)
      const [tiers, setTiers] = React.useState(null)
      const [providers, setProviders] = React.useState([])
      const [models, setModels] = React.useState({})
      const [efforts, setEfforts] = React.useState({})
      const [saving, setSaving] = React.useState(false)
      const [saved, setSaved] = React.useState("")
      const [error, setError] = React.useState("")

      const loadCatalog = React.useCallback((provider, model) => {
        if (provider === "") return
        const url = CATALOG_URL + "?provider=" + encodeURIComponent(provider)
          + (model === "" ? "" : "&model=" + encodeURIComponent(model))
        fetch(url, { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (json === null) return
            setModels((prev) => ({ ...prev, [provider]: json.models || [] }))
            setEfforts((prev) => ({ ...prev, [provider + "|" + model]: json.efforts || [] }))
          })
          .catch(() => { /* a failed catalog fetch leaves the row editable by hand */ })
      }, [])

      React.useEffect(() => {
        let live = true
        fetch(CONFIG_URL, { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + String(res.status)))))
          .then((json) => {
            if (!live) return
            const next = json.tiers || {}
            setTiers(next)
            setProviders(Array.isArray(json.providers) ? json.providers : [])
            setWritable(json.writable === true)
            setLoading(false)
            for (const row of TIER_ROWS) {
              const tier = tierOf(next, row.key)
              if (tier.provider !== "") loadCatalog(tier.provider, tier.model)
            }
          })
          .catch((failure) => {
            if (!live) return
            setError(String(failure && failure.message ? failure.message : failure))
            setLoading(false)
          })
        return () => { live = false }
      }, [loadCatalog])

      const setTier = (key, patch) => {
        setTiers((prev) => {
          const next = { ...(prev || {}) }
          next[key] = { ...tierOf(prev, key), ...patch }
          return next
        })
        setSaved("")
      }

      const changeProvider = (key, provider) => {
        setTier(key, { provider, model: "", effort: "" })
        if (provider !== "") loadCatalog(provider, "")
      }

      const changeModel = (key, model) => {
        const current = tierOf(tiers, key)
        setTier(key, { model, effort: "" })
        if (current.provider !== "") loadCatalog(current.provider, model)
      }

      const save = () => {
        setSaving(true)
        setSaved("")
        setError("")
        fetch(CONFIG_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tiers: savableTiers(tiers) }),
        })
          .then(async (res) => {
            const json = await res.json().catch(() => null)
            if (!res.ok) throw new Error(json && json.error ? json.error : "HTTP " + String(res.status))
            if (json && json.tiers) setTiers(json.tiers)
            setSaved("已保存，下一轮生效")
          })
          .catch((failure) => setError(String(failure && failure.message ? failure.message : failure)))
          .finally(() => setSaving(false))
      }

      if (loading) return React.createElement("p", { className: "routerNeoHint" }, "正在读取插件配置…")

      const rows = TIER_ROWS.map(({ key, label }) => {
        const tier = tierOf(tiers, key)
        const modelList = tier.provider === "" ? [] : (models[tier.provider] || [])
        const effortList = tier.provider === "" || tier.model === ""
          ? [] : (efforts[tier.provider + "|" + tier.model] || [])
        return React.createElement("tr", { key }, [
          React.createElement("td", { key: "label" }, label),
          React.createElement("td", { key: "provider" }, React.createElement("select", {
            value: tier.provider,
            disabled: saving || !writable,
            onChange: (event) => changeProvider(key, event.target.value),
          }, optionList(providers, tier.provider, "（内置默认）"))),
          React.createElement("td", { key: "model" }, React.createElement("select", {
            value: tier.model,
            disabled: saving || !writable || tier.provider === "",
            onChange: (event) => changeModel(key, event.target.value),
          }, optionList(modelList, tier.model, tier.provider === "" ? "（内置默认）" : "选择模型…"))),
          React.createElement("td", { key: "effort" }, React.createElement("select", {
            value: tier.effort,
            disabled: saving || !writable || tier.model === "",
            onChange: (event) => setTier(key, { effort: event.target.value }),
          }, optionList(effortList, tier.effort, effortList.length === 0 ? "适配器默认" : "跟随模型默认"))),
        ])
      })

      return React.createElement("div", { className: "routerNeoTierEditor" }, [
        React.createElement("p", { className: "routerNeoHint", key: "hint" },
          "按档位指定供应商与模型（可跨供应商）；effort 留空表示用适配器默认值。"
          + "判定由基元律动 NeoHorse-Jev-4B 给出档位，再按该表路由主模型。"),
        React.createElement("table", { className: "routerNeoTable", key: "table" }, [
          React.createElement("thead", { key: "head" }, React.createElement("tr", null, [
            React.createElement("th", { key: "a" }, "档位"),
            React.createElement("th", { key: "b" }, "供应商"),
            React.createElement("th", { key: "c" }, "模型"),
            React.createElement("th", { key: "d" }, "思考档位 effort"),
          ])),
          React.createElement("tbody", { key: "body" }, rows),
        ]),
        React.createElement("div", { className: "routerNeoActions", key: "actions" }, [
          React.createElement("button", {
            key: "save", className: "routerNeoButton", disabled: saving || !writable, onClick: save,
          }, saving ? "保存中…" : "保存"),
          React.createElement("button", {
            key: "reset",
            className: "routerNeoButton",
            disabled: saving || !writable,
            onClick: () => {
              setTiers({ low: { ...EMPTY_TIER }, high: { ...EMPTY_TIER }, max: { ...EMPTY_TIER }, fallback: { ...EMPTY_TIER } })
              setSaved("")
            },
          }, "恢复内置默认"),
          saved === "" ? null : React.createElement("span", { key: "saved", className: "routerNeoStatus" }, saved),
          error === "" ? null : React.createElement("span", { key: "error", className: "routerNeoStatus routerNeoError" }, error),
        ]),
        writable ? null : React.createElement("p", { className: "routerNeoHint", key: "readonly" },
          "当前 profile 没有可编辑的插件行，此页只能查看。"),
      ])
    }

    function apply(ctx) {
      if (styleEl === null) {
        styleEl = document.createElement("style")
        styleEl.setAttribute("data-router-neohorse", "tier-chip")
        styleEl.textContent = CSS
        document.head.appendChild(styleEl)
      }
      startPolling()
      ctx.effect(() => () => {
        if (poller !== null) { clearInterval(poller); poller = null }
        if (styleEl !== null && styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl)
        styleEl = null
      })
      ctx.slots.inject("conversation.input.right", () => ctx.slots.register(
        { name: "conversation.input.right", id: "router-neohorse-tier", order: 5 },
        (slotProps) => React.createElement(Chip, {
          sessionId: slotProps === undefined || slotProps === null ? undefined : slotProps.sessionId,
        }),
      ))
      // The plugin page's tier editor. The `key` is the package name: the manager renders this
      // section on that bundle's page only when a slot entry carries exactly that key.
      ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register(
        { name: "plugins.bundle.config", key: PACKAGE_KEY },
        ConfigPage,
      ))
    }

    exports.name = "router-neohorse-client"
    exports.inject = ["slots"]
    exports.apply = apply
    return module.exports
  },
})
