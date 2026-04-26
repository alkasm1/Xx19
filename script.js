// ================= SETTINGS =================
const B=32, LMAX=12, SIZE=1024, HEADER=24;

// CRC32 stored in header bytes [8..11]
const HEADER_CRC_OFFSET = 8;   // bytes [8..11]
const HEADER_RESERVED_OFFSET = 12; // bytes [12..23]

// ================= CHAR TABLE =================
const indexToChar={
  1:"ا",2:"ب",3:"ت",4:"ث",5:"ج",6:"ح",7:"خ",8:"د",9:"ذ",
  10:"ر",11:"ز",12:"س",13:"ش",14:"ص",15:"ض",16:"ط",
  17:"ظ",18:"ع",19:"غ",20:"ف",21:"ق",22:"ك",23:"ل",
  24:"م",25:"ن",26:"ه",27:"و",28:"ي",
  29:"ء"
};

const charToIndex={};
for (let k in indexToChar) charToIndex[indexToChar[k]] = Number(k);

// ================= ALM OPS TABLE =================
const ALM_OPS = {
  11: normalizeArabic,
  12: cleanText,
  13: crc32,
  14: wordToCode,
  15: codeToWord,
  16: getByteFromBigIntLE,
  17: drawByteToBuffer,
  18: drawCountToBuffer,
  19: drawCrc32ToBuffer,
  20: readByteFromBuffer,
  21: readCrc32FromBuffer
};

function ALM_RUN(id, ...args){
  // لو يوجد برنامج ALM لهذا الـ ID
  if(ALM_PROGRAMS[id]){
    let value = args[0]; // cleanText تستقبل نص واحد

    for(const step of ALM_PROGRAMS[id]){
      const type = step[0];

      if(type === "OP"){
        const opId = step[1];

        // 11 = normalizeArabic
        if(opId === 11){
          value = normalizeArabic(value);
        }

        // 12.1 = إزالة غير العربية
        if(opId === 12.1){
          value = value.replace(/[^ا-يء ]+/g, " ");
        }

        // 12.2 = ضغط المسافات
        if(opId === 12.2){
          value = value.replace(/\s+/g, " ").trim();
        }
      }
    }

    return value;
  }

  // الوضع القديم (fallback)
  const fn = ALM_OPS[id];
  if(!fn) throw new Error("ALM: unknown op " + id);
  return fn(...args);
}async function ALM_LOAD(){
  const res = await fetch("alm_core.alm");
  const txt = await res.text();
  const lines = txt.split("\n");

  for(const line of lines){
    const t = line.trim();
    if(!t || t.startsWith("#")) continue;

    const parts = t.split(" ");
    const id = Number(parts[1]);
    const name = parts[2];

    // فقط نربط الاسم بالـ ID (للمستقبل)
    ALM_OPS_NAMES[id] = name;
  }
}

const ALM_OPS_NAMES = {};
ALM_LOAD();
// ================= ALM PROGRAMS =================
const ALM_PROGRAMS = {
  12: [
    ["OP", 11],   // NORMALIZE_ARABIC
    ["OP", 12.1], // REMOVE_NON_ARABIC (سنعرّفها بعد قليل)
    ["OP", 12.2]  // COMPRESS_SPACES
  ]
};
ALM_PROGRAMS[14] = [
  ["RESET_ACC"],

  // loop over characters (ALM interpreter will handle looping)
  ["FOR_EACH_CHAR", [
    ["PUSH_CHAR_INDEX"],
    ["ACCUMULATE_BASE32"],
    ["NEXT_POSITION"]
  ]],

  ["RETURN_ACC"]
];
// ================= TEXT CLEAN =================
function normalizeArabic(s){
  s = (s || "");
  return s
    .replace(/ئ/g,"ي")
    .replace(/ة/g,"ه");
}

function cleanText(t){
  t = normalizeArabic(t);

  let out = "";
  for (const ch of t) {
    if (ch === " " || ch === "\n" || ch === "\t") {
      out += " ";
    } else if (charToIndex[ch]) {
      out += ch;
    }
  }
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

// ================= CRC32 (string input) =================
function crc32(str) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[i] = c >>> 0;
    }
    return t;
  })());

  const bytes = new TextEncoder().encode(str);

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ================= EXTRACT FILE =================
async function extractText(file){
  const name = file.name.toLowerCase();

  // WORD
  if(name.endsWith(".docx")){
    const buf = await file.arrayBuffer();
    const zip = new JSZip();
    const doc = await zip.loadAsync(buf);
    const text = await doc.file("word/document.xml").async("string");
    return text.replace(/<[^>]+>/g, " ");
  }

  // PDF
  if(name.endsWith(".pdf")){
    const buf = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({data: buf});
    const pdf = await loadingTask.promise;

    let text = "";

    for(let i=1;i<=pdf.numPages;i++){
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      const items = content.items.map(it => {
        const tr = it.transform || [1,0,0,1,0,0];
        const x = tr[4];
        const y = tr[5];
        return { str: it.str, x, y };
      });

      const Y_TOL = 5;

      items.sort((a,b) => b.y - a.y);

      const lines = [];
      for(const it of items){
        let placed = false;
        for(const line of lines){
          if(Math.abs(line.y - it.y) <= Y_TOL){
            line.items.push(it);
            line.y = (line.y * (line.items.length-1) + it.y) / line.items.length;
            placed = true;
            break;
          }
        }
        if(!placed){
          lines.push({ y: it.y, items: [it] });
        }
      }

      lines.sort((a,b) => b.y - a.y);

      for(const line of lines){
        line.items.sort((a,b) => b.x - a.x);
        const lineText = line.items.map(x => x.str).join(" ");
        if(lineText.trim()){
          text += lineText + "\n";
        }
      }
    }

    return text;
  }

  throw new Error("نوع غير مدعوم. المدعوم: .docx أو .pdf");
}

// ================= ENCODE HELPERS =================
function wordToCode(w){
  const c = new Array(LMAX).fill(0);
  let p=0;
  for (let i=w.length-1; i>=0; i--){
    const idx = charToIndex[w[i]];
    if(idx === undefined) continue;
    c[p++] = idx;
    if(p>=LMAX) break;
  }
  let C=0n;
  for(let i=0;i<LMAX;i++){
    C += BigInt(c[i]) * (BigInt(B) ** BigInt(i));
  }
  return C;
}

function codeToWord(C){
  let out="";
  for(let i=0;i<LMAX;i++){
    const d = Number(C % BigInt(B));
    C /= BigInt(B);
    if(d) out = indexToChar[d] + out;
  }
  return out;
}

function getByteFromBigIntLE(Cbig, byteIndex){
  return Number((Cbig >> BigInt(8*byteIndex)) & 0xFFn);
}

// ================= DRAW (FAST) =================
function drawByteToBuffer(buf, p, byteVal){
  const gray = 255 - (byteVal & 0xFF);
  const i = p * 4;
  buf[i] = gray;
  buf[i+1] = gray;
  buf[i+2] = gray;
  buf[i+3] = 255;
}

function drawCountToBuffer(buf, countBig){
  for(let i=0;i<8;i++){
    const v = Number((countBig >> BigInt(8*i)) & 0xFFn);
    drawByteToBuffer(buf, i, v);
  }
}

function drawCrc32ToBuffer(buf, crc32u, offset){
  for(let i=0;i<4;i++){
    const v = (crc32u >>> (8*i)) & 0xFF;
    drawByteToBuffer(buf, offset + i, v);
    
  }// ================= GLOBAL STATE =================
let lastDecodedText = "";

// ================= ENCODE =================
const btnEncode = document.getElementById("btnEncode");
const btnSaveImage = document.getElementById("btnSaveImage");
const btnDecode = document.getElementById("btnDecode");
const btnExport = document.getElementById("btnExport");

const statusEncode = document.getElementById("statusEncode");
const statusDecode = document.getElementById("statusDecode");
const outputText = document.getElementById("outputText");

btnEncode.onclick = async () => {
  try{
    lastDecodedText = "";
    outputText.textContent = "—";
    statusDecode.textContent = "انتظر عملية فك التشفير.";

    const file = document.getElementById("docInput").files[0];
    if(!file) return alert("اختر ملف Word أو PDF.");

    statusEncode.textContent = "جاري استخراج النص من الملف...";
    btnEncode.disabled = true;

    let text = await extractText(file);
    text = ALM_RUN(12, text);
    if(!text) throw new Error("لم يتم استخراج نص صالح بعد التنقية.");

    const crc = ALM_RUN(13, text);
    const key = BigInt(document.getElementById("userKey").value || 0);

    const words = text.split(" ");
    const blocks = [];
    for (const w of words) {
      for (let i=0; i<w.length; i+=LMAX) {
        blocks.push(w.slice(i, i+LMAX));
      }
    }

    const capacityBytes = SIZE*SIZE;
    const needed = HEADER + blocks.length*8;
    if(needed > capacityBytes){
      throw new Error("النص كبير جدًا لصورة واحدة. تحتاج زيادة SIZE أو تقطيع (chunking).");
    }

    const canvas = document.getElementById("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const ctx = canvas.getContext("2d", { willReadFrequently: false });

    const imgData = ctx.createImageData(SIZE, SIZE);
    const buf = imgData.data;

    for (let i=0; i<buf.length; i+=4){
      buf[i]=255; buf[i+1]=255; buf[i+2]=255; buf[i+3]=255;
    }

    const countBig = BigInt(blocks.length);
    ALM_RUN(18, buf, countBig);

    ALM_RUN(19, buf, crc, HEADER_CRC_OFFSET);

    for(let p=HEADER_RESERVED_OFFSET; p<HEADER; p++){
      ALM_RUN(17, buf, p, 0);
    }

    for (let bi=0; bi<blocks.length; bi++){
      const b = blocks[bi];
      const C = ALM_RUN(14, b) ^ key;

      for(let j=0; j<8; j++){
        const byteVal = ALM_RUN(16, C, j);
        const p = HEADER + bi*8 + j;
        ALM_RUN(17, buf, p, byteVal);
      }
    }

    ctx.putImageData(imgData, 0, 0);

    statusEncode.textContent = `تم التشفير بنجاح ✅ عدد البلوكات: ${blocks.length}`;
    btnEncode.disabled = false;
  }catch(e){
    btnEncode.disabled = false;
    console.error(e);
    statusEncode.textContent = "فشل التشفير: " + (e?.message || e);
    alert(e?.message || e);
  }
};

btnSaveImage.onclick = () => {
  const canvas = document.getElementById("canvas");
  if(!canvas.width || !canvas.height) return alert("لا توجد صورة بعد. نفّذ التحويل أولاً.");
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "encoded.png";
  a.click();
};

// ================= DECODE =================
function readByteFromBuffer(data, p){
  const i = p * 4;
  const gray = data[i];
  return 255 - gray;
}

function readCrc32FromBuffer(data, offset){
  let crc = 0;
  for(let i=0;i<4;i++){
    const v = readByteFromBuffer(data, offset + i) & 0xFF;
    crc |= (v << (8*i)) >>> 0;
  }
  return crc >>> 0;
}

btnDecode.onclick = async () => {
  try{
    statusDecode.textContent = "جاري فك التشفير...";
    btnDecode.disabled = true;
    lastDecodedText = "";

    const file = document.getElementById("imageInput").files[0];
    if(!file) throw new Error("اختر صورة PNG.");

    const key = BigInt(document.getElementById("userKey").value || 0);

    const img = new Image();
    const url = URL.createObjectURL(file);

    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("تعذر تحميل الصورة."));
      img.src = url;
    });

    URL.revokeObjectURL(url);

    const canvas = document.getElementById("canvas");
    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const size = canvas.width;
    const data = ctx.getImageData(0,0,size,size).data;

    if(size !== SIZE){
      statusDecode.textContent = `تحذير: حجم الصورة = ${size}×${size} وليس 1024×1024. قد يحدث خطأ.`;
    }

    let count=0n;
    for(let i=0;i<8;i++){
      const v = readByteFromBuffer(data, i);
      count |= (BigInt(v) << BigInt(8*i));
    }

    const blocksCount = Number(count);
    if(!Number.isFinite(blocksCount) || blocksCount <= 0){
      throw new Error("لم يتم العثور على عدد صحيح للبلوكات في الهيدر.");
    }

    const crcRead = ALM_RUN(21, data, HEADER_CRC_OFFSET);

    const blocks=[];
    for(let bi=0; bi<blocksCount; bi++){
      let C=0n;
      for(let j=0; j<8; j++){
        const p = HEADER + bi*8 + j;
        const v = ALM_RUN(20, data, p);
        C |= (BigInt(v) << BigInt(8*j));
      }

      const w = ALM_RUN(15, BigInt(C ^ key));
      if(w) blocks.push(w);
    }

    const text = blocks.join(" ");
    lastDecodedText = text;

    const crcCalc = ALM_RUN(13, text);
    const ok = (crcCalc >>> 0) === (crcRead >>> 0);

    outputText.textContent = text || "—";
    statusDecode.textContent = ok
      ? `تم فك التشفير ✅ عدد البلوكات: ${blocksCount} \nCRC: ✅ OK`
      : `تم فك التشفير ⚠️ عدد البلوكات: ${blocksCount}\nCRC: ❌ فشل (الصورة تغيّرت).`;

    btnDecode.disabled = false;
  }catch(e){
    btnDecode.disabled = false;
    statusDecode.textContent = "فشل فك التشفير: " + (e?.message || e);
    alert(e?.message || e);
  }
};

// ================= EXPORT =================
btnExport.onclick = async () => {
  try{
    const exportMode = document.getElementById("exportMode").value;
    if(!lastDecodedText) throw new Error("لا يوجد نص مفكوك.");

    if(exportMode === "word"){
      statusDecode.textContent = "جاري إنشاء ملف Word...";
      const { Document, Packer, Paragraph } = window.docx;

      const doc = new Document({
        sections: [{ children: [new Paragraph(lastDecodedText)] }]
      });

      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, "decoded.docx");
      statusDecode.textContent = "تم تنزيل Word ✅";
    }else{
      statusDecode.textContent = "جاري إنشاء ملف PDF...";
      const { jsPDF } = window.jspdf;

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

      const lines = doc.splitTextToSize(lastDecodedText, 180);
      doc.text(lines, 10, 10);
      doc.save("decoded.pdf");
      statusDecode.textContent = "تم تنزيل PDF ✅";
    }
  }catch(e){
    console.error(e);
    statusDecode.textContent = "فشل التصدير: " + (e?.message || e);
    alert(e?.message || e);
  }
};

function downloadBlob(blob, name){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
}
