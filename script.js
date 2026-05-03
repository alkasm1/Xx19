/****************************************************
 * ALM ENGINE + CORE SETTINGS
 ****************************************************/

const B = 32;
const LMAX = 12;
const SIZE = 1024;
const HEADER = 24;

const HEADER_CRC_OFFSET = 8;
const HEADER_RESERVED_OFFSET = 12;

/****************************************************
 * CHAR TABLE
 ****************************************************/

const indexToChar = {
  1:"ا",2:"ب",3:"ت",4:"ث",5:"ج",6:"ح",7:"خ",8:"د",9:"ذ",
  10:"ر",11:"ز",12:"س",13:"ش",14:"ص",15:"ض",16:"ط",
  17:"ظ",18:"ع",19:"غ",20:"ف",21:"ق",22:"ك",23:"ل",
  24:"م",25:"ن",26:"ه",27:"و",28:"ي",29:"ء"
};

const charToIndex = {};
for (let k in indexToChar) charToIndex[indexToChar[k]] = Number(k);

/****************************************************
 * NORMALIZE + CLEAN (WITH SAFE NEWLINE TOKEN)
 ****************************************************/
function normalizeArabic(text){
  if(!text) return "";
  return text
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function cleanText(text){
  text = normalizeArabic(text);

  let out = "";
  for (const ch of text) {

    if (ch === "\n") {
      out += " ␤ ";   // ← رمز سطر آمن
    }

    else if (ch === " " || ch === "\t") {
      out += " ";
    }

    else if (charToIndex[ch]) {
      out += ch;
    }
  }

  return out.replace(/\s+/g, " ").trim();
}

/****************************************************
 * CRC32
 ****************************************************/
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

/****************************************************
 * FILE EXTRACTION — KEEP NEWLINES
 ****************************************************/
async function extractText(file){
  const name = file.name.toLowerCase();

  if(name.endsWith(".docx")){
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml").async("string");
    return xml.replace(/<[^>]+>/g, "\n");
  }

  if(name.endsWith(".pdf")){
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: buf}).promise;

    let text = "";
    for(let i=1;i<=pdf.numPages;i++){
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const line = content.items.map(i=>i.str).join(" ");
      text += line + "\n";
    }
    return text;
  }

  throw new Error("نوع غير مدعوم");
}

/****************************************************
 * ALM CORE FUNCTIONS (ORIGINAL — DO NOT CHANGE)
 ****************************************************/
function wordToCode(w){
  let C = 0n;
  let pos = 0;

  for (let i=w.length-1; i>=0 && pos<LMAX; i--){
    const idx = charToIndex[w[i]] || 0;
    C += BigInt(idx) * (BigInt(B) ** BigInt(pos));
    pos++;
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

/****************************************************
 * DRAW
 ****************************************************/
function drawByte(buf, p, byte){
  const gray = 255 - (byte & 255);
  const i = p * 4;
  buf[i] = gray;
  buf[i+1] = gray;
  buf[i+2] = gray;
  buf[i+3] = 255;
}

function readByte(data, p){
  return 255 - data[p*4];
}

/****************************************************
 * ALM SIGNATURE (رأفت عمر)
 ****************************************************/
const SIGNATURE_TEXT = "رأفت عمر";
const SIGNATURE_CODE = wordToCode(cleanText(SIGNATURE_TEXT));

function drawSignature(buf){
  for(let i=0;i<12;i++){
    const b = Number((SIGNATURE_CODE >> BigInt(8*i)) & 0xFFn);
    drawByte(buf, HEADER_RESERVED_OFFSET + i, b);
  }
}

/****************************************************
 * UI ELEMENTS
 ****************************************************/
const btnEncode = document.getElementById("btnEncode");
const btnDecode = document.getElementById("btnDecode");
const btnSaveImage = document.getElementById("btnSaveImage");
const btnExport = document.getElementById("btnExport");

const statusEncode = document.getElementById("statusEncode");
const statusDecode = document.getElementById("statusDecode");
const outputText = document.getElementById("outputText");

const progressBox = document.getElementById("progressBox");
const progressBar = document.getElementById("progressBar");

const fileSizeSpan = document.getElementById("fileSize");
const blockCountSpan = document.getElementById("blockCount");

const tabEncode = document.getElementById("tabEncode");
const tabDecode = document.getElementById("tabDecode");
const cardEncode = document.getElementById("cardEncode");
const cardDecode = document.getElementById("cardDecode");

const btnAdvancedToggle = document.getElementById("btnAdvancedToggle");
const advancedBox = document.getElementById("advancedBox");

let lastDecodedText = "";

/****************************************************
 * HELPERS
 ****************************************************/
function setProgress(p){
  progressBox.style.display = "block";
  progressBar.style.width = p + "%";
  if(p >= 100){
    setTimeout(()=>{ progressBox.style.display = "none"; }, 600);
  }
}

function setStatusEncode(msg){
  statusEncode.innerHTML = "<b>الحالة:</b> " + msg;
}

function setStatusDecode(msg){
  statusDecode.innerHTML = "<b>الحالة:</b> " + msg;
}

/****************************************************
 * TABS
 ****************************************************/
tabEncode.onclick = () => {
  tabEncode.classList.add("active");
  tabDecode.classList.remove("active");
  cardEncode.style.display = "block";
  cardDecode.style.display = "none";
};

tabDecode.onclick = () => {
  tabDecode.classList.add("active");
  tabEncode.classList.remove("active");
  cardEncode.style.display = "none";
  cardDecode.style.display = "block";
};

/****************************************************
 * ADVANCED TOGGLE
 ****************************************************/
btnAdvancedToggle.onclick = () => {
  advancedBox.style.display = (advancedBox.style.display === "none" || !advancedBox.style.display)
    ? "block" : "none";
};

/****************************************************
 * ENCODE (ORIGINAL + SAFE NEWLINES)
 ****************************************************/
btnEncode.onclick = async () => {
  try{
    const fileInput = document.getElementById("docInput");
    const file = fileInput.files[0];
    if(!file){
      alert("اختر ملف Word أو PDF أولاً");
      return;
    }

    setStatusEncode("جاري قراءة الملف...");
    setProgress(10);

    let text = await extractText(file);
    text = cleanText(text);

    if(!text){
      setStatusEncode("لم يتم العثور على نص صالح بعد التنظيف.");
      return;
    }

    const key = BigInt(document.getElementById("userKey").value || 0);
    const mode = document.getElementById("mode").value;

    const words = text.split(" ");
    const blocks = [];

    for (const w of words){
      for(let i=0;i<w.length;i+=LMAX){
        blocks.push(w.slice(i,i+LMAX));
      }
    }

    fileSizeSpan.textContent = (file.size/1024).toFixed(1) + " KB";
    blockCountSpan.textContent = blocks.length.toString();

    setStatusEncode("جاري تجهيز الصورة...");
    setProgress(40);

    const canvas = document.getElementById("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(SIZE, SIZE);
    const buf = img.data;

    for(let i=0;i<buf.length;i+=4){
      buf[i]=255;buf[i+1]=255;buf[i+2]=255;buf[i+3]=255;
    }

    let count = BigInt(blocks.length);
    for(let i=0;i<8;i++){
      drawByte(buf,i, Number((count>>BigInt(8*i))&0xFFn));
    }

    const crc = crc32(text);
    for(let i=0;i<4;i++){
      drawByte(buf,HEADER_CRC_OFFSET+i,(crc>>(8*i))&0xFF);
    }

    drawSignature(buf);

    setStatusEncode("جاري ترميز البيانات...");
    setProgress(70);

    let ptr = HEADER;

    for(const b of blocks){
      let C = wordToCode(b) ^ key;

      if(mode === "v2"){
        for(let r=0;r<2;r++){
          for(let j=0;j<8;j++){
            drawByte(buf,ptr++, Number((C>>BigInt(8*j))&0xFFn));
          }
        }
      }else{
        for(let j=0;j<8;j++){
          drawByte(buf,ptr++, Number((C>>BigInt(8*j))&0xFFn));
        }
      }
    }

    ctx.putImageData(img,0,0);
    setProgress(100);
    setStatusEncode("تم التشفير وإنشاء الصورة بنجاح");

  }catch(e){
    console.error(e);
    alert(e.message);
    setStatusEncode("حدث خطأ أثناء الترميز.");
  }
};
/****************************************************
 * DECODE (ORIGINAL + SAFE NEWLINES)
 ****************************************************/
btnDecode.onclick = async () => {
  try{
    const file = document.getElementById("imageInput").files[0];
    if(!file){
      alert("اختر صورة PNG أولاً");
      return;
    }

    setStatusDecode("جاري تحميل الصورة...");
    const key = BigInt(document.getElementById("userKey").value || 0);
    const mode = document.getElementById("mode").value;

    const img = new Image();
    img.src = URL.createObjectURL(file);

    await new Promise(r=>img.onload=r);

    const canvas = document.getElementById("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img,0,0);

    const data = ctx.getImageData(0,0,SIZE,SIZE).data;

    let count = 0n;
    for(let i=0;i<8;i++){
      count |= BigInt(readByte(data,i)) << BigInt(8*i);
    }

    const blocks = [];
    let ptr = HEADER;

    for(let i=0;i<Number(count);i++){
      let C=0n;

      if(mode==="v2"){
        let votes = Array(8).fill(0);

        for(let r=0;r<2;r++){
          for(let j=0;j<8;j++){
            votes[j] += readByte(data,ptr++);
          }
        }

        for(let j=0;j<8;j++){
          const avg = Math.round(votes[j]/2);
          C |= BigInt(avg) << BigInt(8*j);
        }

      }else{
        for(let j=0;j<8;j++){
          C |= BigInt(readByte(data,ptr++)) << BigInt(8*j);
        }
      }

      const w = codeToWord(C ^ key);
      if(w) blocks.push(w);
    }

    // إعادة بناء النص
    let text = blocks.join(" ");

    // إعادة الأسطر
    text = text.replace(/␤/g, "\n");

    lastDecodedText = text || "";
    outputText.textContent = text || "لم يتم استخراج نص.";

    setStatusDecode("تم فك التشفير بنجاح");

  }catch(e){
    console.error(e);
    alert(e.message);
    setStatusDecode("حدث خطأ أثناء فك التشفير.");
  }
};

/****************************************************
 * SAVE IMAGE
 ****************************************************/
btnSaveImage.onclick = () => {
  const canvas = document.getElementById("canvas");
  if(!canvas.width || !canvas.height){
    alert("لا توجد صورة حالية للحفظ.");
    return;
  }
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "alm_book_encoded.png";
  a.click();
};

/****************************************************
 * EXPORT
 ****************************************************/
btnExport.onclick = async () => {
  if(!lastDecodedText){
    alert("لا يوجد نص مستخرج بعد. قم أولاً بفك التشفير من صورة.");
    return;
  }

  const mode = document.getElementById("exportMode").value;

  if(mode==="word"){
    const { Document, Packer, Paragraph } = window.docx;
    const doc = new Document({
      sections:[{children:[new Paragraph(lastDecodedText)]}]
    });
    const blob = await Packer.toBlob(doc);
    download(blob,"alm_book_file.docx");
  }else{
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    const lines = pdf.splitTextToSize(lastDecodedText, 180);
    pdf.text(lines,10,10);
    pdf.save("alm_book_file.pdf");
  }
};

function download(blob,name){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
