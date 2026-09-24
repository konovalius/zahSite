/* Дневник оценок — версия 2 (профили детей, черновики, цели, выплачено, тепловая карта). */
(function () {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var REWARD = cfg.rewards || { "5": 200, "4": 150, "3": 0, "2": 0 };
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return new Intl.NumberFormat("ru-RU").format(n); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); };
  var dateStr = function (t) { return new Date(t).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }); };
  var SUBJECTS = ["Математика", "Русский язык", "Литература", "Окружающий мир", "Английский язык", "История", "Обществознание", "География", "Биология", "Физика", "Химия", "Информатика", "Технология", "Физкультура", "Музыка", "ИЗО", "ОБЖ"];

  var toastTimer = null;
  function toast(m) { var t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1200); }

  var client = null;
  try { client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey); } catch (e) {}

  var state = { role: "child", children: [], childId: null, grades: [], goal: null, selGrade: null };

  /* ---------- modal ---------- */
  var modalSubmit = null;
  function openModal(opts) {
    $("modalTitle").textContent = opts.title || "";
    $("modalText").textContent = opts.text || "";
    $("modalErr").textContent = "";
    var box = $("modalFields"); box.innerHTML = "";
    (opts.fields || []).forEach(function (f) {
      var l = document.createElement("label"); l.textContent = f.label; box.appendChild(l);
      var el;
      if (f.type === "select") {
        el = document.createElement("select");
        (f.options || []).forEach(function (o) { var op = document.createElement("option"); op.value = o.v; op.textContent = o.t; el.appendChild(op); });
      } else { el = document.createElement("input"); el.type = f.type || "text"; el.placeholder = f.placeholder || ""; if (f.value != null) el.value = f.value; }
      el.id = "mf_" + f.key; box.appendChild(el);
    });
    modalSubmit = opts.onSubmit; $("modalCancel").onclick = closeModal; $("modal").classList.remove("hidden");
    var first = box.querySelector("input,select"); if (first) first.focus();
  }
  function closeModal() { $("modal").classList.add("hidden"); modalSubmit = null; }
  function collect() {
    var v = {}; $("modalFields").querySelectorAll("input,select").forEach(function (el) { v[el.id.replace("mf_", "")] = el.value.trim(); }); return v;
  }
  function askPin(text) { return new Promise(function (res) { openModal({ title: "Подтверждение родителя", text: text, fields: [{ key: "pin", label: "PIN", type: "password" }], onSubmit: function (v) { closeModal(); res(v.pin); } }); $("modalCancel").onclick = function () { closeModal(); res(null); }; }); }

  /* ---------- data ---------- */
  function req(r) { if (r.error) throw r.error; return r.data; }

  async function loadAll() {
    try {
      state.children = req(await client.from("children").select("*").order("created_at", { ascending: true }));
      if (!state.children.length) { state.children = [{ id: null, name: "Ребёнок", emoji: "🧒" }]; }
      var saved = localStorage.getItem("gt.child");
      if (!saved || !state.children.some(function (c) { return c.id === saved; })) saved = state.children[0].id;
      state.childId = saved;
      renderChildSel();
      await loadChild();
    } catch (e) { toast("Ошибка загрузки: " + (e.message || e)); }
  }
  async function loadChild() {
    try {
      var cid = state.childId;
      var grades = req(await client.from("grades").select("*").eq("child_id", cid).order("created_at", { ascending: true }));
      var g = req(await client.from("goals").select("*").eq("child_id", cid).eq("active", true).order("created_at", { ascending: false }).limit(1));
      state.grades = grades; state.goal = g[0] || null;
    } catch (e) { state.grades = []; state.goal = null; toast("Ошибка загрузки: " + (e.message || e)); }
    render();
  }

  function confirmed() { return state.grades.filter(function (g) { return g.status === "confirmed"; }).sort(function (a, b) { return new Date(a.confirmed_at) - new Date(b.confirmed_at); }); }
  function pending() { return state.grades.filter(function (g) { return g.status === "pending"; }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); }); }
  function drafts() { return state.grades.filter(function (g) { return g.status === "draft"; }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); }); }

  function totals() {
    var cs = confirmed(); var sum = 0, gsum = 0, fives = 0, fours = 0, lows = 0;
    cs.forEach(function (e) { sum += (e.reward || 0); gsum += e.grade; if (e.grade === 5) fives++; else if (e.grade === 4) fours++; else lows++; });
    var days = {}; cs.forEach(function (e) { if (e.grade === 5) days[new Date(e.confirmed_at).toDateString()] = 1; });
    var streak = 0, d = new Date(); while (days[d.toDateString()]) { streak++; d.setDate(d.getDate() - 1); }
    return { sum: sum, fives: fives, fours: fours, lows: lows, count: cs.length, avg: cs.length ? gsum / cs.length : null, streak: streak, cs: cs };
  }
  function child() { return state.children.filter(function (c) { return c.id === state.childId; })[0] || { name: "—", emoji: "🧒", paid_total: 0 }; }

  /* ---------- actions ---------- */
  var refreshTimer = null;
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(function () { loadChild(); }, 400); }
  function normalizeSubject(s) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    if (!s) return s;
    var low = s.toLowerCase();
    var canon = SUBJECTS.filter(function (x) { return x.toLowerCase() === low; })[0];
    if (canon) return canon;
    var known = {};
    state.grades.forEach(function (g) { var k = String(g.subject || "").toLowerCase(); if (k && !known[k]) known[k] = g.subject; });
    if (known[low]) return known[low];
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  async function addDraft() {
    if (state.sending) return;
    var subj = normalizeSubject($("subject").value), g = state.selGrade;
    if (!subj || g == null) return;
    state.sending = true;
    $("subject").value = ""; selGradeReset();
    var tmp = { id: "tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), subject: subj, grade: g, status: "pending", reward: 0, created_at: new Date().toISOString(), confirmed_at: null };
    state.grades.push(tmp); render();
    try {
      var ins = await client.from("grades").insert({ child_id: state.childId, subject: subj, grade: g, status: "pending", reward: 0 });
      if (ins.error) throw ins.error;
      toast("Твоя заявка отправлена");
      scheduleRefresh();
    } catch (e) {
      state.grades = state.grades.filter(function (x) { return x.id !== tmp.id; }); render();
      toast("Не удалось отправить: " + (e.message || e));
      $("subject").value = subj; selectGrade(g);
    } finally { state.sending = false; }
  }
  async function sendGrade(id) {
    try { req(await client.from("grades").update({ status: "pending" }).eq("id", id)); toast("Твоя заявка отправлена"); await loadChild(); }
    catch (e) { toast("Не удалось отправить: " + (e.message || e)); }
  }
  async function removeDraft(id) {
    try { req(await client.from("grades").delete().eq("id", id)); await loadChild(); }
    catch (e) { toast("Нельзя удалить: " + (e.message || e)); }
  }
  async function confirmGrade(id, curGrade) {
    var pin = await askPin("PIN родителя для подтверждения"); if (pin == null) return;
    var ng = null;
    try {
      var r = await client.rpc("set_grade_status", { p_id: id, p_pin: pin, p_status: "confirmed", p_grade: curGrade });
      if (r.error) throw r.error;
      toast("Подтверждено"); await loadChild();
    } catch (e) { toast(/pin/i.test(e.message || "") ? "Неверный PIN" : ("Ошибка: " + (e.message || e))); }
  }
  async function rejectGrade(id) {
    var pin = await askPin("PIN родителя для отклонения"); if (pin == null) return;
    try { var r = await client.rpc("set_grade_status", { p_id: id, p_pin: pin, p_status: "rejected" }); if (r.error) throw r.error; toast("Отклонено"); await loadChild(); }
    catch (e) { toast(/pin/i.test(e.message || "") ? "Неверный PIN" : ("Ошибка: " + (e.message || e))); }
  }
  function newGoal() {
    openModal({
      title: "Новая цель-мечта", text: "Опиши, к чему копим.", fields: [
        { key: "title", label: "Название", placeholder: "Наушники" },
        { key: "url", label: "Ссылка на товар", type: "url", placeholder: "https://…" },
        { key: "image", label: "Ссылка на картинку (необязательно)", type: "url", placeholder: "https://…jpg" },
        { key: "target", label: "Стоимость, ₽", type: "number", value: "1000" }
      ],
      onSubmit: async function (v) {
        if (!v.title || !v.target) { $("modalErr").textContent = "Заполни название и стоимость"; return; }
        try {
          req(await client.from("goals").insert({ child_id: state.childId, title: v.title, url: v.url || null, image_url: v.image || null, target: parseInt(v.target, 10), active: true }));
          closeModal(); toast("Цель сохранена"); await loadChild();
        } catch (e) { $("modalErr").textContent = "Ошибка: " + (e.message || e); }
      }
    });
  }
  function editPaid() {
    openModal({
      title: "Выплачено", text: "Итоговая сумма, которую ты уже выдал(", fields: [
        { key: "paid", label: "Выплачено, ₽", type: "number", value: String(child().paid_total || 0) }
      ],
      onSubmit: null
    });
    // reinterpret: single field paid + pin
    $("modalText").textContent = "Итоговая сумма, которую ты уже выдал. Подтверди PIN.";
    var box = $("modalFields");
    var l = document.createElement("label"); l.textContent = "PIN"; box.appendChild(l);
    var pin = document.createElement("input"); pin.type = "password"; pin.id = "mf_pin"; box.appendChild(pin);
    modalSubmit = async function (v) {
      if (!v.paid || !v.pin) { $("modalErr").textContent = "Заполни оба поля"; return; }
      try { var r = await client.rpc("set_paid", { p_child: state.childId, p_pin: v.pin, p_total: parseInt(v.paid, 10) }); if (r.error) throw r.error; closeModal(); toast("Сохранено"); await loadChild(); }
      catch (e) { $("modalErr").textContent = /pin/i.test(e.message || "") ? "Неверный PIN" : ("Ошибка: " + (e.message || e)); }
    };
  }
  function addChild() {
    openModal({
      title: "Добавить ребёнка", text: "Профиль ребёнка (родительский PIN).", fields: [
        { key: "name", label: "Имя", placeholder: "Например: Миша" },
        { key: "emoji", label: "Эмодзи-аватар", value: "🧒" },
        { key: "pin", label: "PIN", type: "password" }
      ],
      onSubmit: async function (v) {
        if (!v.name || !v.pin) { $("modalErr").textContent = "Заполни имя и PIN"; return; }
        try { var r = await client.rpc("add_child", { p_pin: v.pin, p_name: v.name, p_emoji: v.emoji || "🧒" }); if (r.error) throw r.error; closeModal(); toast("Ребёнок добавлен"); await loadAll(); }
        catch (e) { $("modalErr").textContent = /pin/i.test(e.message || "") ? "Неверный PIN" : ("Ошибка: " + (e.message || e)); }
      }
    });
  }

  /* ---------- render ---------- */
  function renderChildSel() {
    var s = $("childSel"); s.innerHTML = "";
    state.children.forEach(function (c) { var o = document.createElement("option"); o.value = c.id || ""; o.textContent = (c.emoji || "🧒") + " " + c.name; if (c.id === state.childId) o.selected = true; s.appendChild(o); });
  }
  function checks(status) {
    if (status === "draft") return '<span class="checks one" title="не отправлено">✓</span>';
    if (status === "pending") return '<span class="checks two" title="отправлено">✓✓</span>';
    if (status === "confirmed") return '<span class="checks done" title="подтверждено">✓✓</span>';
    return '<span class="muted">—</span>';
  }
  function render() {
    var t = totals();
    // child select
    renderChildSel();
    $("mTotal").textContent = fmt(t.sum) + " ₽";
    $("mStreak").textContent = fmt(t.streak);
    $("mConfirmed").textContent = fmt(t.count);
    $("mAvg").textContent = t.avg != null ? t.avg.toFixed(2) : "—";
    var lvl = 1 + Math.floor(t.fives / 3), done = t.fives % 3, names = ["Новичок", "Ученик", "Знаток", "Отличник", "Мастер", "Профессор", "Легенда"];
    $("lvlName").textContent = "· " + names[Math.min(lvl - 1, names.length - 1)] + " · ур. " + lvl;
    $("lvlFill").style.width = Math.round(done / 3 * 100) + "%";
    $("lvlHint").textContent = "До следующего уровня: ещё " + (3 - done) + " пятёрк" + ((3 - done) === 1 ? "а" : "и");
    $("stars").textContent = "★".repeat(Math.min(t.fives, 20)) + "☆".repeat(Math.max(0, Math.min(20 - t.fives, 20)));
    $("motive").textContent = t.count === 0 ? "Запиши первую оценку — и здесь появится прогресс!" :
      (t.streak >= 3 ? "🔥 Серия " + t.streak + " дня с пятёрками!" : "Так держать! Копи на мечту.");

    // badges
    var A = [["⭐", "Первая пятёрка", t.fives >= 1], ["🌟", "5 пятёрок", t.fives >= 5], ["💫", "10 пятёрок", t.fives >= 10], ["🔥", "3 дня подряд", t.streak >= 3], ["💰", "1000 ₽", t.sum >= 1000], ["🎯", "10 оценок", t.count >= 10]];
    $("badges").innerHTML = A.map(function (a) { return '<span class="badge ' + (a[2] ? "" : "locked") + '"><span>' + a[0] + "</span>" + esc(a[1]) + "</span>"; }).join("");

    // heatmap (last 16 weeks)
    renderHeat(t.cs);

    // goal
    renderGoal(t.sum);

    // child queue (drafts + pending)
    renderChildQueue();

    // parent
    $("pAccrued").textContent = fmt(t.sum) + " ₽";
    $("pPaid").textContent = fmt(child().paid_total || 0) + " ₽";
    $("pAvg").textContent = t.avg != null ? t.avg.toFixed(2) : "—";
    renderParentQueue();
    var run = 0;
    var rows = t.cs.map(function (e) { run += (e.reward || 0); return e;
    });
    $("entriesBody").innerHTML = t.cs.length ? t.cs.map(function (e) { var c = Object.assign({}, e); return c; }).map((function () { var acc = 0; return function (e) { acc += (e.reward || 0); return "<tr><td>" + dateStr(e.confirmed_at) + "</td><td>" + esc(e.subject) + '</td><td class="num"><span class="pill p-' + e.grade + '">' + e.grade + '</span></td><td class="num">' + (e.reward > 0 ? "+" + fmt(e.reward) + " ₽" : "0 ₽") + '</td><td class="num" style="font-weight:800">' + fmt(acc) + " ₽</td></tr>"; }; })()) : '<tr><td colspan="5"><div class="empty">Пока нет подтверждённых оценок.</div></td></tr>';
  }
  function renderHeat(cs) {
    var count = {};
    cs.forEach(function (e) { var d = new Date(e.confirmed_at); var k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); count[k] = (count[k] || 0) + 1; });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today); start.setDate(start.getDate() - (16 * 7 - 1));
    var html = "";
    for (var w = 0; w < 16; w++) {
      html += '<div class="week">';
      for (var dow = 0; dow < 7; dow++) {
        var d = new Date(start); d.setDate(start.getDate() + w * 7 + dow);
        if (d > today) { html += "<i></i>"; continue; }
        var k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
        var n = count[k] || 0; var cls = n === 0 ? "" : "l" + Math.min(4, n);
        html += '<i class="' + cls + '" title="' + dateStr(d) + ": " + n + '"></i>';
      }
      html += "</div>";
    }
    $("heat").innerHTML = html;
  }
  function renderGoal(sum) {
    if (!state.goal) { $("goalBox").innerHTML = '<div class="empty">Цель не задана. Нажми «Новая цель».</div>'; return; }
    var g = state.goal, pct = g.target > 0 ? Math.min(100, Math.round(sum / g.target * 100)) : 0;
    var thumb = g.image_url ? '<img src="' + esc(g.image_url) + '" alt="' + esc(g.title) + '" onerror="this.parentNode.textContent=\'🎁\'">' : "🎁";
    var left = Math.max(0, g.target - sum);
    $("goalBox").innerHTML = '<div class="goal"><div class="thumb">' + thumb + '</div><div class="gbody">' +
      '<div class="gtitle">' + esc(g.title) + "</div>" +
      '<div class="sub">' + (g.url ? '<a href="' + esc(g.url) + '" target="_blank" rel="noopener">ссылка на товар</a> · ' : "") + "осталось " + fmt(left) + " ₽ из " + fmt(g.target) + "</div>" +
      '<div class="levelbar"><div style="width:' + pct + '%"></div></div>' +
      '<div class="sub">' + pct + "% собрано</div></div></div>";
  }
  function renderChildQueue() {
    var items = drafts().concat(pending());
    if (!items.length) { $("childQueue").innerHTML = '<div class="empty">Ты ещё ничего не внёс.</div>'; return; }
    $("childQueue").innerHTML = items.map(function (p) {
      var act = p.status === "draft"
        ? '<button class="btn btn-primary btn-sm" data-send="' + p.id + '">Отправить</button><button class="btn btn-no btn-sm" data-del="' + p.id + '">Удалить</button>'
        : '<span class="pill p-wait">ждёт подтверждения</span><button class="btn btn-no btn-sm" data-del="' + p.id + '">Отменить</button>';
      return '<li><div class="q-main"><div class="q-sub">' + esc(p.subject) + '</div><div class="q-meta">' + dateStr(p.created_at) + '</div></div>' +
        '<span class="pill p-' + p.grade + '">' + p.grade + "</span>" + checks(p.status) + act + "</li>";
    }).join("");
    $("childQueue").querySelectorAll("[data-send]").forEach(function (b) { b.onclick = function () { sendGrade(b.dataset.send); }; });
    $("childQueue").querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { removeDraft(b.dataset.del); }; });
  }
  function renderParentQueue() {
    var items = pending();
    if (!items.length) { $("parentQueue").innerHTML = '<div class="empty">Нет новых заявок.</div>'; return; }
    $("parentQueue").innerHTML = items.map(function (p) {
      var opts = [2, 3, 4, 5].map(function (g) { return '<option value="' + g + '"' + (g === p.grade ? " selected" : "") + ">" + g + "</option>"; }).join("");
      return '<li><div class="q-main"><div class="q-sub">' + esc(p.subject) + '</div><div class="q-meta">' + dateStr(p.created_at) + " · " + checks(p.status) + "</div></div>" +
        '<select data-g="' + p.id + '">' + opts + "</select>" +
        '<button class="btn btn-ok btn-sm" data-ok="' + p.id + '">Подтвердить</button>' +
        '<button class="btn btn-no btn-sm" data-no="' + p.id + '">Отклонить</button></li>';
    }).join("");
    $("parentQueue").querySelectorAll("[data-ok]").forEach(function (b) {
      b.onclick = function () { var sel = $("parentQueue").querySelector('[data-g="' + b.dataset.ok + '"]'); confirmGrade(b.dataset.ok, parseInt(sel.value, 10)); };
    });
    $("parentQueue").querySelectorAll("[data-no]").forEach(function (b) { b.onclick = function () { rejectGrade(b.dataset.no); }; });
  }

  /* ---------- grade select ---------- */
  function selectGrade(g) { state.selGrade = g; document.querySelectorAll(".grade-btn").forEach(function (b) { b.className = "grade-btn"; if (Number(b.dataset.grade) === g) b.classList.add("sel-" + g); }); updateAdd(); }
  function selGradeReset() { state.selGrade = null; document.querySelectorAll(".grade-btn").forEach(function (b) { b.className = "grade-btn"; }); updateAdd(); }
  function updateAdd() { $("addBtn").disabled = !($("subject").value.trim() && state.selGrade != null); renderCompose(); }
  function renderCompose() {
    var box = $("composeBox"); if (!box) return;
    var subj = $("subject").value.trim(), g = state.selGrade;
    if (subj && g != null) {
      box.classList.remove("hidden");
      box.innerHTML = "К отправке: <b>" + esc(subj) + "</b> · оценка <b>" + g + "</b>" + (REWARD[g] > 0 ? " (+<b>" + fmt(REWARD[g]) + " ₽</b>)" : "");
    } else { box.classList.add("hidden"); }
  }
  function renderChips() {
    var box = $("subjChips"); if (!box) return;
    box.innerHTML = SUBJECTS.map(function (s) { return '<button type="button" class="chip">' + esc(s) + "</button>"; }).join("");
    var chips = box.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) (function (b) { b.onclick = function () { $("subject").value = b.textContent; updateAdd(); }; })(chips[i]);
  }

  /* ---------- voice ---------- */
  var gw = { "два": 2, "две": 2, "двойка": 2, "три": 3, "тройка": 3, "четыре": 4, "четверка": 4, "четвёрка": 4, "пять": 5, "пятерка": 5, "пятёрка": 5, "2": 2, "3": 3, "4": 4, "5": 5 };
  var STOP = { "по": 1, "за": 1, "в": 1, "на": 1, "и": 1, "получил": 1, "получила": 1, "оценка": 1 };
  function parseSpeech(text) {
    var norm = text.toLowerCase().replace(/ё/g, "е"); var toks = norm.split(/[\s,.;]+/).filter(Boolean);
    var g = null, sub = [];
    toks.forEach(function (w) { var ww = w.replace(/ё/g, "е"); if (g == null && gw[w] != null) { g = gw[w]; return; } if (g == null && gw[ww] != null) { g = gw[ww]; return; } sub.push(w); });
    var s = sub.filter(function (w) { return !STOP[w]; }).join(" ").trim();
    s = normalizeSubject(s);
    return { subject: s, grade: g };
  }
  function startMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $("micHint").textContent = "Голосовой ввод не поддерживается — впиши вручную."; return; }
    if (!window.isSecureContext && location.protocol !== "file:") { $("micHint").textContent = "Микрофон только на https."; return; }
    var rec = new SR(); rec.lang = "ru-RU"; rec.interimResults = false;
    var btn = $("micBtn"); btn.classList.add("listening"); btn.textContent = "🎙️ Слушаю…";
    rec.onresult = function (e) {
      var text = e.results[0][0].transcript;
      var p = parseSpeech(text);
      if (p.subject) $("subject").value = p.subject;
      if (p.grade != null) selectGrade(p.grade);
      $("micHint").textContent = "Расслышал: «" + text + "»" + (p.subject ? " → предмет: " + p.subject : "") + (p.grade != null ? ", оценка: " + p.grade : ", оценку не понял — выбери кнопкой");
      updateAdd();
    };
    rec.onerror = function () { toast("Не удалось распознать"); };
    rec.onend = function () { btn.classList.remove("listening"); btn.textContent = "🎤 Сказать"; };
    try { rec.start(); } catch (e) {}
  }

  /* ---------- role ---------- */
  function setRole(role) {
    state.role = role; localStorage.setItem("gt.role", role);
    $("tabChild").classList.toggle("active", role === "child"); $("tabParent").classList.toggle("active", role === "parent");
    $("tabChild").setAttribute("aria-selected", role === "child"); $("tabParent").setAttribute("aria-selected", role === "parent");
    $("childView").classList.toggle("hidden", role !== "child"); $("parentView").classList.toggle("hidden", role !== "parent");
  }

  /* ---------- boot ---------- */
  async function boot() {
    // wire
    $("tabChild").onclick = function () { setRole("child"); };
    $("tabParent").onclick = function () { setRole("parent"); };
    $("subject").addEventListener("input", updateAdd);
    document.querySelectorAll(".grade-btn").forEach(function (b) { b.onclick = function () { selectGrade(Number(b.dataset.grade)); }; });
    $("addBtn").onclick = addDraft; $("micBtn").onclick = startMic;
    $("newGoalBtn").onclick = newGoal; $("editPaidBtn").onclick = editPaid; $("addChildBtn").onclick = addChild;
    $("childSel").onchange = async function () { state.childId = this.value; localStorage.setItem("gt.child", state.childId); state.grades = []; state.goal = null; render(); await loadChild(); };
    $("modalOk").onclick = function () { if (modalSubmit) modalSubmit(collect()); };
    $("modalCancel").onclick = closeModal;
    $("modal").addEventListener("click", function (e) { if (e.target === $("modal")) closeModal(); });

    setRole(localStorage.getItem("gt.role") || "child");
    renderChips();

    if (!client) { toast("Не загрузилась библиотека данных. Обнови страницу (Ctrl+F5)."); return; }
    try { var s = await client.auth.getSession(); if (!s.data.session) { var r = await client.auth.signInAnonymously(); if (r.error) throw r.error; } }
    catch (e) { toast("Не удалось подключиться: " + (e.message || e)); }
    client.channel("gt-live").on("postgres_changes", { event: "*", schema: "public", table: "grades" }, function () { scheduleRefresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "goals" }, function () { scheduleRefresh(); }).subscribe();
    await loadAll();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
