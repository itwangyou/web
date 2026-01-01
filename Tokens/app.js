// app.js

const state = {
  ids: ["inTokens", "outTokens", "groupMul", "compMul", "inPrice", "outPrice"],
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
  const outPrice = n($("outPrice").value);

  const billTokens = x + y;

  const costIn = (inPrice * x) / 1_000_000;
  const costOut = (outPrice * y) / 1_000_000;
  const cost = costIn + costOut;

  return { billTokens, cost, costIn, costOut };
}

function render() {
  const r = compute();
  $("billTokens").textContent = fmt(r.billTokens, 4);
  $("costCNY").textContent = fmt(r.cost, 10);
  $("costIn").textContent = fmt(r.costIn, 10);
  $("costOut").textContent = fmt(r.costOut, 10);
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