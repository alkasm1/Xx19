/****************************************************

* script.js — ALM + Image Encoder (Stable V1+)
  ****************************************************/

// ================= SETTINGS =================
const B=32, LMAX=12, SIZE=1024, HEADER=24;
const HEADER_CRC_OFFSET = 8;
const HEADER_RESERVED_OFFSET = 12;

const MAGIC = [65,76,77,54]; // ALM6

// ================= CHAR TABLE =================
const indexToChar={
1:"ا",2:"ب",3:"ت",4:"ث",5:"ج",6:"ح",7:"خ",8:"د",9:"ذ",
10:"ر",11:"ز",12:"س",13:"ش",14:"ص",15:"ض",16:"ط",
17:"ظ",18:"ع",19:"غ",20:"ف",21:"ق",22:"ك",23:"ل",
24:"م",25:"ن",26:"ه",27:"و",28:"ي",29:"ء"
};

const charToIndex={};
for (let k in indexToChar) charToIndex[indexToChar[k]] = Number(k);

// ================= TEXT CLEAN =================
function normalizeArabic(s){
return (s||"")
.replace(/[إأآ]/g,"ا")
.replace(/ى/g,"ي")
.replace(/ة/g,"ه")
.replace(/ؤ/g,"و")
.replace(/ئ/g,"ي");
}

function cleanText(t){
t = normalizeArabic(t);
let out="";
for(const ch of t){
if(ch===" "||ch==="\n"||ch==="\t") out+=" ";
else if(charToIndex[ch]) out+=ch;
}
return out.replace(/\s+/g," ").trim();
}

// ================= CRC32 =================
function crc32(str){
const table = crc32.table || (crc32.table = (() => {
const t = new Array(256);
for (let i=0;i<256;i++){
let c=i;
for(let k=0;k<8;k++){
c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
}
t[i]=c>>>0;
}
return t;
})());

const bytes = new TextEncoder().encode(str);
let crc=0xFFFFFFFF;
for(let i=0;i<bytes.length;i++){
crc=(crc>>>8)^table[(crc^bytes[i])&0xFF];
}
return (crc^0xFFFFFFFF)>>>0;
}

// ================= FILE EXTRACT =================
async function extractText(file){
const name = file.name.toLowerCase();

if(name.endsWith(".docx")){
const buf = await file.arrayBuffer();
const res = await mammoth.extractRawText({arrayBuffer: buf});
return res.value || "";
}

if(name.endsWith(".pdf")){
const buf = await file.arrayBuffer();
const pdf = await pdfjsLib.getDocument({data: buf}).promise;

let text="";
for(let i=1;i<=pdf.numPages;i++){
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  const strings = content.items.map(it=>it.str);
  text += strings.join(" ")+"\n";
}
return text;

}

throw new Error("نوع غير مدعوم");
}

// ================= ENCODE HELPERS =================
function wordToCode(w){
const c = new Array(LMAX).fill(0);
let p=0;
for(let i=w.length-1;i>=0;i--){
const idx = charToIndex[w[i]];
if(idx===undefined) continue;
c[p++]=idx;
if(p>=LMAX) break;
}
let C=0n;
for(let i=0;i<LMAX;i++){
C += BigInt(c[i])*(BigInt(B)**BigInt(i));
}
return C;
}

function codeToWord(C){
let out="";
for(let i=0;i<LMAX;i++){
const d = Number(C % BigInt(B));
C/=BigInt(B);
if(d) out = indexToChar[d] + out;
}
return out;
}

function getByteFromBigIntLE(Cbig, byteIndex){
return Number((Cbig >> BigInt(8*byteIndex)) & 0xFFn);
}

// ================= DRAW =================
function drawByte(buf,p,val){
const gray = 255-(val&0xFF);
const i=p*4;
buf[i]=gray;
buf[i+1]=gray;
buf[i+2]=gray;
buf[i+3]=255;
}

function readByte(data,p){
return 255 - data[p*4];
}

// ================= UI =================
const btnEncode = document.getElementById("btnEncode");
const btnDecode = document.getElementById("btnDecode");
const btnSaveImage = document.getElementById("btnSaveImage");
const btnExport = document.getElementById("btnExport");

const statusEncode = document.getElementById("statusEncode");
const statusDecode = document.getElementById("statusDecode");
const outputText = document.getElementById("outputText");

let lastDecodedText="";

// ================= ENCODE =================
btnEncode.onclick = async ()=>{
try{
const file = document.getElementById("docInput").files[0];
if(!file) return alert("اختر ملف");

statusEncode.textContent="جاري المعالجة...";
btnEncode.disabled=true;

let text = await extractText(file);
text = cleanText(text);
if(!text) throw new Error("لا يوجد نص صالح");

const crc = crc32(text);
const key = BigInt(document.getElementById("userKey").value || 0);

const words = text.split(" ");
const blocks=[];
for(const w of words){
  for(let i=0;i<w.length;i+=LMAX){
    blocks.push(w.slice(i,i+LMAX));
  }
}

const canvas=document.getElementById("canvas");
canvas.width=SIZE;
canvas.height=SIZE;
const ctx=canvas.getContext("2d");
const img=ctx.createImageData(SIZE,SIZE);
const buf=img.data;

for(let i=0;i<buf.length;i+=4){
  buf[i]=255;buf[i+1]=255;buf[i+2]=255;buf[i+3]=255;
}

// HEADER
let count=BigInt(blocks.length);
for(let i=0;i<8;i++){
  drawByte(buf,i,Number((count>>(8n*BigInt(i)))&0xFFn));
}

// MAGIC
for(let i=0;i<4;i++){
  drawByte(buf,8+i,MAGIC[i]);
}

// CRC
for(let i=0;i<4;i++){
  drawByte(buf,HEADER_CRC_OFFSET+i,(crc>>(8*i))&0xFF);
}

// DATA
for(let bi=0;bi<blocks.length;bi++){
  const dynamicKey = key ^ BigInt(bi);
  const C = wordToCode(blocks[bi]) ^ dynamicKey;

  for(let j=0;j<8;j++){
    const p = HEADER + bi*8 + j;
    drawByte(buf,p,getByteFromBigIntLE(C,j));
  }
}

ctx.putImageData(img,0,0);
statusEncode.textContent="تم بنجاح ✅";
btnEncode.disabled=false;

}catch(e){
btnEncode.disabled=false;
alert(e.message);
}
};

// ================= DECODE =================
btnDecode.onclick = async ()=>{
try{
const file = document.getElementById("imageInput").files[0];
if(!file) return alert("اختر صورة");

const key = BigInt(document.getElementById("userKey").value || 0);

const img = new Image();
const url = URL.createObjectURL(file);

await new Promise(res=>{
  img.onload=res;
  img.src=url;
});

const canvas=document.getElementById("canvas");
canvas.width=img.width;
canvas.height=img.height;
const ctx=canvas.getContext("2d");
ctx.drawImage(img,0,0);

const data = ctx.getImageData(0,0,canvas.width,canvas.height).data;

// CHECK MAGIC
for(let i=0;i<4;i++){
  if(readByte(data,8+i)!==MAGIC[i]){
    throw new Error("الصورة ليست ALM");
  }
}

// COUNT
let count=0n;
for(let i=0;i<8;i++){
  count |= BigInt(readByte(data,i))<<(8n*BigInt(i));
}

const blocks=[];
for(let bi=0;bi<Number(count);bi++){
  let C=0n;
  for(let j=0;j<8;j++){
    const p=HEADER+bi*8+j;
    C |= BigInt(readByte(data,p))<<(8n*BigInt(j));
  }
  const dynamicKey = key ^ BigInt(bi);
  blocks.push(codeToWord(C ^ dynamicKey));
}

const text = blocks.join(" ");
lastDecodedText=text;

const crcStored = (
  readByte(data,8) |
  (readByte(data,9)<<8) |
  (readByte(data,10)<<16) |
  (readByte(data,11)<<24)
)>>>0;

const crcNow = crc32(text);

outputText.textContent=text;
statusDecode.textContent = (crcNow===crcStored)
  ? "تم بنجاح ✅"
  : "تحذير: البيانات تغيرت ⚠️";

}catch(e){
alert(e.message);
}
};

// ================= SAVE =================
btnSaveImage.onclick=()=>{
const canvas=document.getElementById("canvas");
const a=document.createElement("a");
a.href=canvas.toDataURL();
a.download="alm.png";
a.click();
};

// ================= EXPORT =================
btnExport.onclick=()=>{
if(!lastDecodedText) return alert("لا يوجد نص");
const blob=new Blob([lastDecodedText],{type:"text/plain"});
const a=document.createElement("a");
a.href=URL.createObjectURL(blob);
a.download="decoded.txt";
a.click();
};
