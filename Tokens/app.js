// app.js

const state = {
  // outPrice 被移除；effOutPrice 为只读展示（输入单价 × 补全倍率）
  ids: ["inTokens", "outTokens", "groupMul", "compMul", "inPrice"],
};

const $ = (id) => document.getElementById(id);

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmt(num, digits = 10) {
  const s = Number(num).toFixed(digits);
  return s.replace(/\.?0+$/, "");
}

function compute() {
  const x = n($("inTokens").value);
  const y = n($("outTokens").value);

  const groupMul = n($("groupMul").value);
  const compMul = n($("compMul").value);

  const inPrice = n($("inPrice").value);

  const billTokens = x + y;

  // 新总价格：
  // 分组倍率 × (输入tokens×输入单价 + 输出tokens×(输入单价×补全倍率)) / 1,000,000
  const costIn = groupMul * (inPrice * x) / 1_000_000;
  const costOut = groupMul * (inPrice * compMul * y) / 1_000_000;
  const cost = costIn + costOut;

  const effOutPrice = inPrice * compMul;

  return { billTokens, cost, costIn, costOut, effOutPrice };
}

function render() {
  const r = compute();

  $("billTokens").textContent = fmt(r.billTokens, 4);
  $("costCNY").textContent = fmt(r.cost, 10);
  $("costIn").textContent = fmt(r.costIn, 10);
  $("costOut").textContent = fmt(r.costOut, 10);

  $("effOutPrice").value = fmt(r.effOutPrice, 6);
}

function bind() {
  state.ids.forEach((id) => {
    $(id).addEventListener("input", render);
  });

  $("btnClearTokens").addEventListener("click", () => {
    $("inTokens").value = 0;
    $("outTokens").value = 0;
    render();
  });
}

bind();
render();