(() => {
  "use strict";

  // ====== 常量 & 工具函数 ======
  const MAGIC_STR = "A256GCM"; // 7 bytes
  const VERSION = 1;
  const SALT_LEN = 16;
  const IV_LEN = 12;
  const TAG_BITS = 128;

  const ITER_MIN = 50000;
  const ITER_MAX = 5000000;
  const ITER_AUTOTUNE_MAX = 2000000;
  const MAX_WARN_SIZE = 512 * 1024 * 1024; // 512MB

  const te = new TextEncoder();
  const td = new TextDecoder();
  const $ = sel => document.querySelector(sel);

  const el = {
    // tabs
    tabEnc: $("#tab-enc"),
    tabDec: $("#tab-dec"),
    paneEnc: $("#pane-enc"),
    paneDec: $("#pane-dec"),

    // encrypt
    file: $("#file"),
    fileInfo: $("#file-info"),
    pass: $("#pass"),
    passStrength: $("#pass-strength"),
    passCapsHint: $("#pass-caps-hint"),
    btnPassToggle: $("#btn-pass-toggle"),
    btnPassGen: $("#btn-pass-gen"),
    btnPassCopy: $("#btn-pass-copy"),
    btnAutotune: $("#btn-autotune"),
    iterations: $("#iterations"),
    hideName: $("#hide-name"),
    advEncToggle: $("#adv-enc-toggle"),
    advEncBody: $("#adv-enc-body"),
    advEncChevron: $("#adv-enc-chevron"),
    btnEncrypt: $("#btn-encrypt"),
    btnClearEnc: $("#btn-clear-enc"),
    statusEnc: $("#status-enc"),
    progEnc: $("#prog-enc"),
    logEncToggle: $("#log-enc-toggle"),
    logEnc: $("#log-enc"),
    btnLogEncCopy: $("#btn-log-enc-copy"),

    // decrypt
    enc: $("#enc"),
    encInfo: $("#enc-info"),
    pass2: $("#pass2"),
    pass2Strength: $("#pass2-strength"),
    pass2CapsHint: $("#pass2-caps-hint"),
    btnPass2Toggle: $("#btn-pass2-toggle"),
    advDecToggle: $("#adv-dec-toggle"),
    advDecBody: $("#adv-dec-body"),
    advDecChevron: $("#adv-dec-chevron"),
    metaInfo: $("#meta-info"),
    btnMetaCopy: $("#btn-meta-copy"),
    btnInspect: $("#btn-inspect"),
    btnDecrypt: $("#btn-decrypt"),
    btnClearDec: $("#btn-clear-dec"),
    statusDec: $("#status-dec"),
    progDec: $("#prog-dec"),
    logDecToggle: $("#log-dec-toggle"),
    logDec: $("#log-dec"),
    btnLogDecCopy: $("#btn-log-dec-copy"),

    // results & toast
    resultList: $("#result-list"),
    toastClean: $("#toast-clean")
  };

  const objectUrls = new Set();

  // 统一错误处理（这里增加错误后立即 flushLog）
  function handleError(context, error, logEl) {
    const message = error?.message || String(error);
    console.error(`[${context}]`, error);
    if(logEl) {
      log(logEl, `错误: ${message}`);
      flushLog(logEl); // 确保错误日志立刻可见
    }
    alert(`错误: ${message}`);
  }

  // 日志缓冲区：累积一定数量后批量写入 DOM，减少重排
  const logBuffer = new Map();

  function log(elLog, msg) {
    if(!logBuffer.has(elLog)) {
      logBuffer.set(elLog, []);
    }
    logBuffer.get(elLog).push(msg);

    // 批量更新：每累积 10 条日志时写入 DOM
    if(logBuffer.get(elLog).length >= 10) {
      flushLog(elLog);
    }
  }

  // 将缓冲的日志立即刷新到 DOM
  function flushLog(elLog) {
    const buffers = logBuffer.get(elLog);
    if(!buffers || buffers.length === 0) return;

    elLog.textContent += buffers.join('\n') + '\n';
    logBuffer.set(elLog, []);
    elLog.scrollTop = elLog.scrollHeight;
  }

  // 重置某个日志区域：清空缓冲 + 清空显示
  function resetLog(elLog) {
    logBuffer.set(elLog, []);
    elLog.textContent = "";
  }

  function setBar(elBar, pct) {
    pct = Math.max(0, Math.min(100, pct));
    elBar.style.width = pct + "%";
  }

  function fmtBytes(x) {
    if(!Number.isFinite(x)) return "?";
    if(x < 1024) return x + " B";
    const units = ["KB", "MB", "GB", "TB"];
    let u = -1;
    do {
      x /= 1024;
      u++;
    } while(x >= 1024 && u < units.length - 1);
    return x.toFixed(1) + " " + units[u];
  }

  function ensureCrypto() {
    if(!window.isSecureContext) throw new Error("需要在安全上下文 HTTPS 或 http://localhost 中使用 WebCrypto");
    if(!crypto.subtle) throw new Error("当前浏览器未启用 WebCrypto 不支持 crypto.subtle");
  }

  function randomBytes(n) {
    const u = new Uint8Array(n);
    crypto.getRandomValues(u);
    return u;
  }

  function setUint64BE(view, offset, value) {
    let v = BigInt(value);
    for(let i = 7; i >= 0; i--) {
      view.setUint8(offset + i, Number(v & 0xffn));
      v >>= 8n;
    }
  }

  function getUint64BE(view, offset) {
    let v = 0n;
    for(let i = 0; i < 8; i++) v = (v << 8n) | BigInt(view.getUint8(offset + i));
    return v;
  }

  function bytesEq(a, b) {
    if(a.length !== b.length) return false;
    let d = 0;
    for(let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }

  function guessMime(name) {
    const n = (name || "").toLowerCase();
    if(n.endsWith(".txt")) return "text/plain";
    if(n.endsWith(".json")) return "application/json";
    if(n.endsWith(".png")) return "image/png";
    if(n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
    if(n.endsWith(".gif")) return "image/gif";
    if(n.endsWith(".pdf")) return "application/pdf";
    if(n.endsWith(".zip")) return "application/zip";
    return "application/octet-stream";
  }

  function estimateEntropyBits(pwd) {
    if(!pwd) return 0;
    let pool = 0;
    if(/[a-z]/.test(pwd)) pool += 26;
    if(/[A-Z]/.test(pwd)) pool += 26;
    if(/[0-9]/.test(pwd)) pool += 10;
    if(/[^A-Za-z0-9]/.test(pwd)) pool += 33;
    return Math.log2(Math.max(1, pool)) * pwd.length;
  }

  function strengthLabel(bits) {
    if(bits < 40) return "弱";
    if(bits < 60) return "一般";
    if(bits < 80) return "较强";
    return "很强";
  }

  function showCleanToast(message) {
    el.toastClean.textContent = message ||
      "敏感数据已自动清理 口令和明文缓冲区已从内存中擦除";
    el.toastClean.classList.add("show");
    setTimeout(() => el.toastClean.classList.remove("show"), 2200);
  }

  function randomPwd(len = 20) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.@#$%*!?~";
    const u = new Uint8Array(len);
    crypto.getRandomValues(u);
    return Array.from(u, x => alphabet[x % alphabet.length]).join("");
  }

  async function copyText(text) {
    try {
      if(navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch {}
  }

  function buildHeader({ saltU8, ivU8, iterations, fileSize, filenameU8, tagBits }) {
    const magicU8 = te.encode(MAGIC_STR);
    const totalLen = 25 + saltU8.length + ivU8.length + filenameU8.length;
    const buf = new ArrayBuffer(totalLen);
    const view = new DataView(buf);
    const out = new Uint8Array(buf);
    let pos = 0;
    out.set(magicU8, pos);
    pos += 7;
    view.setUint8(pos++, VERSION);
    view.setUint8(pos++, saltU8.length);
    view.setUint8(pos++, ivU8.length);
    view.setUint8(pos++, tagBits);
    view.setUint32(pos, iterations, false);
    pos += 4;
    setUint64BE(view, pos, BigInt(fileSize));
    pos += 8;
    view.setUint16(pos, filenameU8.length, false);
    pos += 2;
    out.set(saltU8, pos);
    pos += saltU8.length;
    out.set(ivU8, pos);
    pos += ivU8.length;
    out.set(filenameU8, pos);
    pos += filenameU8.length;
    return out;
  }

  function parseHeader(u8) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if(u8.length < 25) throw new Error("密文文件太短 头部不完整");
    const magic = te.encode(MAGIC_STR);
    if(!bytesEq(u8.subarray(0, 7), magic)) throw new Error("魔数不匹配 不是本工具生成的 AEG 文件");

    let pos = 7;
    const version = view.getUint8(pos++);
    if(version !== VERSION) throw new Error("不支持的版本号 " + version);

    const saltLen = view.getUint8(pos++);
    const ivLen = view.getUint8(pos++);
    const tagBits = view.getUint8(pos++);

    if(saltLen !== SALT_LEN) throw new Error("盐长度异常 仅支持 16 字节");
    if(ivLen !== IV_LEN) throw new Error("IV 长度异常 仅支持 12 字节");
    if(tagBits !== TAG_BITS) throw new Error("Tag 长度异常 仅支持 128 bit");

    const iterations = view.getUint32(pos, false);
    pos += 4;
    if(iterations < ITER_MIN || iterations > ITER_MAX) {
      throw new Error("PBKDF2 迭代次数异常");
    }

    const sizeBI = getUint64BE(view, pos);
    pos += 8;
    if(sizeBI > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("原始大小超过支持范围");
    const originalSize = Number(sizeBI);

    const filenameLen = view.getUint16(pos, false);
    pos += 2;
    if(filenameLen > 1024) throw new Error("文件名长度异常");

    const need = 25 + saltLen + ivLen + filenameLen;
    if(u8.length < need) throw new Error("头部声明长度与实际不符");

    const saltU8 = u8.subarray(pos, pos + saltLen);
    pos += saltLen;
    const ivU8 = u8.subarray(pos, pos + ivLen);
    pos += ivLen;
    const filenameU8 = u8.subarray(pos, pos + filenameLen);
    pos += filenameLen;

    const headerPrefix = u8.subarray(0, pos);
    const cipherU8 = u8.subarray(pos);

    const tagLenBytes = tagBits >>> 3;
    if(cipherU8.length !== originalSize + tagLenBytes) {
      throw new Error("密文长度与头部记录不一致");
    }

    return {
      version,
      saltU8,
      ivU8,
      tagBits,
      iterations,
      originalSize,
      filename: td.decode(filenameU8),
      headerPrefix,
      cipherU8
    };
  }

  async function deriveKey(passU8, saltU8, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passU8, { name: "PBKDF2" },
      false,
      ["deriveKey", "deriveBits"]
    );
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: saltU8, iterations, hash: "SHA-256" },
      keyMaterial, { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    return key;
  }

  // 结果卡片
  function makeResultCard({ blob, filename, label }) {
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);

    const card = document.createElement("div");
    card.className = "rcard";

    const head = document.createElement("div");
    head.className = "rhead";

    const title = document.createElement("div");
    title.className = "rtitle";
    title.textContent = `${label}：${filename}`;

    const meta = document.createElement("div");
    meta.className = "rmeta";
    meta.textContent = `${fmtBytes(blob.size)} · ${(blob.type || guessMime(filename))}`;

    head.appendChild(title);
    head.appendChild(meta);

    const acts = document.createElement("div");
    acts.className = "racts";

    const btnDl = document.createElement("button");
    btnDl.className = "btn-mini";
    btnDl.type = "button";
    btnDl.textContent = "💾 下载到本地";

    const btnShare = document.createElement("button");
    btnShare.className = "btn-mini";
    btnShare.type = "button";
    btnShare.textContent = "📤 系统分享";

    acts.appendChild(btnDl);
    acts.appendChild(btnShare);

    const pv = document.createElement("div");
    pv.className = "preview";

    card.appendChild(head);
    card.appendChild(acts);
    card.appendChild(pv);

    el.resultList.prepend(card);

    const mime = blob.type || guessMime(filename);

    btnDl.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    btnShare.addEventListener("click", async () => {
      try {
        const file = new File([blob], filename, { type: mime });
        if(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
        } else {
          alert("当前环境不支持系统分享文件 可以先下载到本地");
        }
      } catch {}
    });

    // 轻量预览
    const SMALL = 512 * 1024;
    if(mime.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = filename;
      pv.appendChild(img);
    } else if(mime.startsWith("video/")) {
      const v = document.createElement("video");
      v.src = url;
      v.controls = true;
      pv.appendChild(v);
    } else if(mime.startsWith("audio/")) {
      const a = document.createElement("audio");
      a.src = url;
      a.controls = true;
      pv.appendChild(a);
    } else if(mime === "application/json" && blob.size <= SMALL) {
      blob.text().then(t => {
        const pre = document.createElement("pre");
        try {
          pre.textContent = JSON.stringify(JSON.parse(t), null, 2).slice(0, 20000);
        } catch {
          pre.textContent = t.slice(0, 20000);
        }
        pv.appendChild(pre);
      }).catch(() => {});
    } else if(mime.startsWith("text/") && blob.size <= SMALL) {
      blob.text().then(t => {
        const pre = document.createElement("pre");
        pre.textContent = t.slice(0, 20000);
        pv.appendChild(pre);
      }).catch(() => {});
    } else {
      const span = document.createElement("div");
      span.className = "muted";
      span.textContent = "此类型暂不支持在线预览 请直接下载后查看";
      pv.appendChild(span);
    }
  }

  // 自动测算迭代次数
  async function autotuneIterations() {
    ensureCrypto();
    el.statusEnc.textContent = "正在测算合适迭代次数";
    setBar(el.progEnc, 20);
    const passU8 = te.encode("test-password-123!@#");
    const saltU8 = randomBytes(SALT_LEN);
    const base = 100000;

    const keyMaterial = await crypto.subtle.importKey("raw", passU8, { name: "PBKDF2" }, false, ["deriveBits"]);
    const t0 = performance.now();
    await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltU8, iterations: base, hash: "SHA-256" },
      keyMaterial,
      256
    );
    const t1 = performance.now();
    passU8.fill(0);
    saltU8.fill(0);

    const elapsed = t1 - t0;
    const target = 500;
    const factor = target / Math.max(1, elapsed);
    let est = Math.round((base * factor) / 1000) * 1000;
    if(!Number.isFinite(est) || est <= 0) est = base;
    est = Math.min(Math.max(est, ITER_MIN), ITER_AUTOTUNE_MAX);
    el.iterations.value = est;
    setBar(el.progEnc, 0);
    el.statusEnc.textContent = `推荐迭代次数约为 ${est.toLocaleString()} 基准 ${base.toLocaleString()} 次耗时 ${elapsed.toFixed(1)} ms`;
  }

  // 加密
  async function doEncrypt() {
    ensureCrypto();
    const file = el.file.files[0];
    const pwd = el.pass.value;

    // 开始前：重置加密日志
    resetLog(el.logEnc);
    el.statusEnc.textContent = "准备中…";
    setBar(el.progEnc, 10);

    if(!file) throw new Error("请先选择要加密的文件");
    if(!pwd) throw new Error("请输入加密口令");

    let iterations = Number(el.iterations.value);
    if(!Number.isFinite(iterations)) {
      throw new Error("PBKDF2 迭代次数不合法");
    }
    iterations = Math.round(iterations);
    if(iterations < ITER_MIN || iterations > ITER_MAX) {
      throw new Error(`PBKDF2 迭代次数必须在 ${ITER_MIN.toLocaleString()} 和 ${ITER_MAX.toLocaleString()} 之间`);
    }
    // 同步 UI 显示与实际使用的迭代次数
    el.iterations.value = String(iterations);

    if(file.size > MAX_WARN_SIZE) {
      const msg = "提示 该文件超过 512MB 在浏览器中一次性加密可能占用大量内存 出现卡顿或失败属于正常情况";
      log(el.logEnc, msg);
      el.statusEnc.textContent = "大文件加密提示 处理过程中浏览器可能短暂无响应";
    }

    log(el.logEnc, `读取文件 ${file.name} 大小 ${fmtBytes(file.size)}`);
    const plainBuf = await file.arrayBuffer();

    // 使用 Unicode 规范化处理密码，确保一致性
    const passU8 = te.encode(pwd.normalize('NFKC'));
    const saltU8 = randomBytes(SALT_LEN);
    const ivU8 = randomBytes(IV_LEN);

    // 动态进度：密钥派生阶段
    log(el.logEnc, `派生密钥 PBKDF2-SHA256 迭代 ${iterations.toLocaleString()}`);
    setBar(el.progEnc, 15);
    const key = await deriveKey(passU8, saltU8, iterations);
    setBar(el.progEnc, 45);

    const filenameField = el.hideName.checked ? "" : file.name;
    const headerU8 = buildHeader({
      saltU8,
      ivU8,
      iterations,
      fileSize: plainBuf.byteLength,
      filenameU8: te.encode(filenameField),
      tagBits: TAG_BITS
    });

    // 动态进度：加密阶段
    log(el.logEnc, `AES-256-GCM 加密中 Tag ${TAG_BITS} bit`);
    setBar(el.progEnc, 50);
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivU8, additionalData: headerU8, tagLength: TAG_BITS },
      key,
      plainBuf
    );
    setBar(el.progEnc, 85);

    // 清理明文缓冲区
    new Uint8Array(plainBuf).fill(0);

    const outBlob = new Blob([headerU8, new Uint8Array(cipherBuf)], { type: "application/octet-stream" });
    const outName = file.name + ".aeg";

    // 清理敏感数据
    passU8.fill(0);
    saltU8.fill(0);
    ivU8.fill(0);
    showCleanToast();

    makeResultCard({ blob: outBlob, filename: outName, label: "密文" });

    // 最终进度
    setBar(el.progEnc, 100);
    el.statusEnc.textContent = "加密完成 密文已生成";
    setTimeout(() => setBar(el.progEnc, 0), 250);
  }

  // 解密
  async function doDecrypt() {
    ensureCrypto();
    const encFile = el.enc.files[0];
    const pwd = el.pass2.value;

    // 开始前：重置解密日志
    resetLog(el.logDec);
    el.statusDec.textContent = "准备中…";
    setBar(el.progDec, 10);

    if(!encFile) throw new Error("请先选择密文文件 .aeg");
    if(!pwd) throw new Error("请输入解密口令");

    if(encFile.size > MAX_WARN_SIZE) {
      const msg = "提示 该密文文件超过 512MB 在浏览器中一次性解密可能占用大量内存";
      log(el.logDec, msg);
      el.statusDec.textContent = "大文件解密提示 处理过程中浏览器可能短暂无响应";
    }

    log(el.logDec, `读取密文 ${encFile.name} 大小 ${fmtBytes(encFile.size)}`);
    const u8 = new Uint8Array(await encFile.arrayBuffer());
    log(el.logDec, "解析头部");
    setBar(el.progDec, 15);
    const meta = parseHeader(u8);
    const displayName = meta.filename && meta.filename.trim() ? meta.filename : "已隐藏";
    // 元信息里增加版本与 tagBits，方便调试
    el.metaInfo.value =
      `file=${displayName}, size=${meta.originalSize}B, PBKDF2=${meta.iterations}, ` +
      `v=${meta.version}, tag=${meta.tagBits}bit`;

    // 口令规范化
    const passU8 = te.encode(pwd.normalize('NFKC'));
    setBar(el.progDec, 40);
    el.statusDec.textContent = "正在解密并验证";

    let plainBuf;
    try {
      // 密钥派生阶段
      const key = await deriveKey(passU8, meta.saltU8, meta.iterations);
      setBar(el.progDec, 60);

      // 解密阶段
      plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: meta.ivU8, additionalData: meta.headerPrefix, tagLength: meta.tagBits },
        key,
        meta.cipherU8
      );
    } catch (err) {
      throw new Error("解密失败 可能是口令错误或文件已损坏");
    } finally {
      // 清理敏感数据
      passU8.fill(0);
      meta.saltU8.fill(0);
      meta.ivU8.fill(0);
      showCleanToast();
    }

    setBar(el.progDec, 85);
    const plainName = meta.filename || "recovered.bin";
    const mime = guessMime(plainName);
    const blob = new Blob([plainBuf], { type: mime });
    new Uint8Array(plainBuf).fill(0);

    makeResultCard({ blob, filename: plainName, label: "明文" });

    // 最终进度
    setBar(el.progDec, 100);
    el.statusDec.textContent = "解密成功 明文已生成";
    setTimeout(() => setBar(el.progDec, 0), 250);
  }

  // 仅解析头部
  async function inspectOnly() {
    ensureCrypto();
    const encFile = el.enc.files[0];
    if(!encFile) throw new Error("请先选择密文文件 .aeg");

    // 重置解密日志
    resetLog(el.logDec);
    setBar(el.progDec, 15);
    el.statusDec.textContent = "正在解析头部";

    log(el.logDec, `读取密文 ${encFile.name} 大小 ${fmtBytes(encFile.size)}`);
    const u8 = new Uint8Array(await encFile.arrayBuffer());
    const meta = parseHeader(u8);
    const displayName = meta.filename && meta.filename.trim() ? meta.filename : "已隐藏";
    // 同样丰富元数据展示
    el.metaInfo.value =
      `file=${displayName}, size=${meta.originalSize}B, PBKDF2=${meta.iterations}, ` +
      `v=${meta.version}, tag=${meta.tagBits}bit`;
    log(el.logDec, `版本=${meta.version}, 盐=${meta.saltU8.length}B, IV=${meta.ivU8.length}B, Tag=${meta.tagBits}bit`);
    log(el.logDec, "仅解析头部完成 未尝试解密");

    // 清理非敏感密码学材料（强迫症式安全）
    meta.saltU8.fill(0);
    meta.ivU8.fill(0);
    setBar(el.progDec, 0);
    el.statusDec.textContent = "头部解析完成";
  }

  // 手动清空：完全重置页面状态
  function clearAllSensitive() {
    // 日志 + 缓冲区
    resetLog(el.logEnc);
    resetLog(el.logDec);

    // 文件
    el.file.value = "";
    el.fileInfo.textContent = "尚未选择文件";
    el.enc.value = "";
    el.encInfo.textContent = "尚未选择文件";

    // 口令与强度
    el.pass.value = "";
    updateStrength(el.pass, el.passStrength);
    el.passCapsHint.style.display = "none";

    el.pass2.value = "";
    updateStrength(el.pass2, el.pass2Strength);
    el.pass2CapsHint.style.display = "none";

    // 高级参数
    el.iterations.value = el.iterations.defaultValue || "1000000";
    el.hideName.checked = false;

    // 折叠
    el.advEncBody.setAttribute("aria-hidden", "true");
    el.advEncChevron.textContent = "▼";
    el.advDecBody.setAttribute("aria-hidden", "true");
    el.advDecChevron.textContent = "▼";

    // 元数据
    el.metaInfo.value = "";

    // 状态和进度
    el.statusEnc.textContent = "就绪";
    el.statusDec.textContent = "就绪";
    setBar(el.progEnc, 0);
    setBar(el.progDec, 0);

    // 日志显示状态
    el.logEncToggle.checked = false;
    el.logDecToggle.checked = false;
    el.logEnc.setAttribute("aria-hidden", "true");
    el.logDec.setAttribute("aria-hidden", "true");

    // 结果卡片和 URL
    for(const url of objectUrls) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    objectUrls.clear();
    el.resultList.innerHTML = "";

    showCleanToast("已手动清空当前页面的文件 口令 日志和结果卡片");
  }

  // ====== 事件绑定 ======

  // Tab
  function activateTab(name) {
    const encActive = name === "enc";
    el.tabEnc.setAttribute("aria-selected", encActive ? "true" : "false");
    el.tabDec.setAttribute("aria-selected", encActive ? "false" : "true");
    el.paneEnc.setAttribute("aria-hidden", encActive ? "false" : "true");
    el.paneDec.setAttribute("aria-hidden", encActive ? "true" : "false");
    localStorage.setItem("aeg_tab", encActive ? "enc" : "dec");
  }
  el.tabEnc.addEventListener("click", () => activateTab("enc"));
  el.tabDec.addEventListener("click", () => activateTab("dec"));
  const savedTab = localStorage.getItem("aeg_tab");
  if(savedTab === "dec") activateTab("dec");

  // 文件显示
  el.file.addEventListener("change", () => {
    const f = el.file.files[0];
    el.fileInfo.textContent = f ? `${f.name} · ${fmtBytes(f.size)}` : "尚未选择文件";
  });
  el.enc.addEventListener("change", () => {
    const f = el.enc.files[0];
    el.encInfo.textContent = f ? `${f.name} · ${fmtBytes(f.size)}` : "尚未选择文件";
  });

  // 强度 & CapsLock
  function updateStrength(inputEl, outEl) {
    const pwd = inputEl.value;
    const bits = estimateEntropyBits(pwd);
    if(!pwd) {
      outEl.textContent = "";
      outEl.classList.remove("hint-weak", "hint-strong");
      return;
    }
    const label = strengthLabel(bits);
    outEl.textContent = `强度 ${label} 约为 ${Math.round(bits)} bit`;
    outEl.classList.toggle("hint-weak", bits < 60);
    outEl.classList.toggle("hint-strong", bits >= 80);
  }
  el.pass.addEventListener("input", () => updateStrength(el.pass, el.passStrength));
  el.pass2.addEventListener("input", () => updateStrength(el.pass2, el.pass2Strength));

  function bindCapsHint(inputEl, hintEl) {
    function handler(ev) {
      try {
        const on = ev.getModifierState && ev.getModifierState("CapsLock");
        hintEl.style.display = on ? "block" : "none";
      } catch {}
    }
    inputEl.addEventListener("keydown", handler);
    inputEl.addEventListener("keyup", handler);
  }
  bindCapsHint(el.pass, el.passCapsHint);
  bindCapsHint(el.pass2, el.pass2CapsHint);

  // 口令显隐/生成/复制
  el.btnPassToggle.addEventListener("click", () => {
    el.pass.type = el.pass.type === "password" ? "text" : "password";
  });
  el.btnPass2Toggle.addEventListener("click", () => {
    el.pass2.type = el.pass2.type === "password" ? "text" : "password";
  });

  el.btnPassGen.addEventListener("click", () => {
    const pwd = randomPwd(20);
    el.pass.value = pwd;
    updateStrength(el.pass, el.passStrength);
  });
  el.btnPassCopy.addEventListener("click", () => {
    if(!el.pass.value) return;
    copyText(el.pass.value);
    el.statusEnc.textContent = "已将当前口令复制到剪贴板";
  });

  // 自动迭代
  el.btnAutotune.addEventListener("click", async () => {
    try {
      el.btnAutotune.disabled = true;
      await autotuneIterations();
    } catch (e) { handleError("autotune", e, el.logEnc); } finally { el.btnAutotune.disabled = false; }
  });

  // 高级折叠
  function toggleAdvanced(bodyEl, chevEl) {
    const hidden = bodyEl.getAttribute("aria-hidden") === "true";
    bodyEl.setAttribute("aria-hidden", hidden ? "false" : "true");
    chevEl.textContent = hidden ? "▲" : "▼";
  }
  el.advEncToggle.addEventListener("click", () => toggleAdvanced(el.advEncBody, el.advEncChevron));
  el.advDecToggle.addEventListener("click", () => toggleAdvanced(el.advDecBody, el.advDecChevron));

  // 日志开关 & 复制
  el.logEncToggle.addEventListener("change", () => {
    const show = el.logEncToggle.checked;
    el.logEnc.setAttribute("aria-hidden", show ? "false" : "true");
  });
  el.logDecToggle.addEventListener("change", () => {
    const show = el.logDecToggle.checked;
    el.logDec.setAttribute("aria-hidden", show ? "false" : "true");
  });
  el.btnLogEncCopy.addEventListener("click", () => copyText(el.logEnc.textContent || ""));
  el.btnLogDecCopy.addEventListener("click", () => copyText(el.logDec.textContent || ""));
  el.btnMetaCopy.addEventListener("click", () => copyText(el.metaInfo.value || ""));

  // 主操作
  el.btnEncrypt.addEventListener("click", async () => {
    try {
      el.btnEncrypt.disabled = true;
      el.statusEnc.textContent = "正在加密";
      await doEncrypt();
    } catch (e) {
      handleError("encrypt", e, el.logEnc);
      el.statusEnc.textContent = "加密失败";
      el.logEncToggle.checked = true;
      el.logEnc.setAttribute("aria-hidden", "false");
    } finally {
      el.btnEncrypt.disabled = false;
      flushLog(el.logEnc);
    }
  });

  el.btnDecrypt.addEventListener("click", async () => {
    try {
      el.btnDecrypt.disabled = true;
      el.statusDec.textContent = "正在解密";
      await doDecrypt();
    } catch (e) {
      handleError("decrypt", e, el.logDec);
      el.statusDec.textContent = "解密失败";
      el.logDecToggle.checked = true;
      el.logDec.setAttribute("aria-hidden", "false");
    } finally {
      el.btnDecrypt.disabled = false;
      flushLog(el.logDec);
    }
  });

  el.btnInspect.addEventListener("click", async () => {
    try {
      await inspectOnly();
    } catch (e) {
      handleError("inspect", e, el.logDec);
      el.statusDec.textContent = "解析头部失败";
      el.logDecToggle.checked = true;
      el.logDec.setAttribute("aria-hidden", "false");
      setBar(el.progDec, 0);
    } finally {
      flushLog(el.logDec);
    }
  });

  // 手动清空按钮
  el.btnClearEnc.addEventListener("click", clearAllSensitive);
  el.btnClearDec.addEventListener("click", clearAllSensitive);

  // 页面离开前：刷新日志 + 释放 object URL
  window.addEventListener("beforeunload", () => {
    flushLog(el.logEnc);
    flushLog(el.logDec);

    for(const url of objectUrls) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    objectUrls.clear();
  });

})();