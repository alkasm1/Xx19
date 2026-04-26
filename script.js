/****************************************************
 * ALM GeoFreq v1 STABLE
 * Clean Architecture Version
 ****************************************************/

/**************** SETTINGS ****************/
const B = 32;
const LMAX = 12;
const SIZE = 1024;
const HEADER = 24;

const HEADER_VERSION_OFFSET = 12;
const HEADER_KEYCHECK_OFFSET = 13;
const HEADER_CRC_OFFSET = 8;

/**************** CHAR TABLE ****************/
const indexToChar = {
  1:"ا",2:"ب",3:"ت",4:"ث",5:"ج",6:"ح",7:"خ",8:"د",9:"ذ",
  10:"ر",11:"ز",12:"س",13:"ش",14:"ص",15:"ض",16:"ط",
  17:"ظ",18:"ع",19:"غ",20:"ف",21:"ق",22:"ك",23:"ل",
  24:"م",25:"ن",26:"ه",27:"و",28:"ي",29:"ء"
};

const charToIndex = {};
for (let k in indexToChar) charToIndex[indexToChar[k]] = Number(k);

/**************** CORE ****************/

function normalizeArabic(s){
  return (s || "")
    .replace(/[إأآ]/g,"ا")
    .replace(/ى/g,"ي")
    .replace(/ة/g,"ه")
    .replace(/ئ/g,"ي");
}

function cleanText(t){
  t = normalizeArabic(t);
  let out = "";
  for (const ch of t) {
    if (ch === " " || ch === "\n") out += " ";
    else if (charToIndex[ch]) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**************** CRC ****************/
function crc32(str){
  const table = crc32.table || (crc32.table = (() => {
    const t = new Array(256);
    for (let i=0;i<256;i++){
      let c=i;
      for(let k=0;k<8;k++){
        c = (c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
      }
      t[i]=c>>>0;
    }
    return t;
  })());

  const bytes = new TextEncoder().encode(str);
  let crc = 0xFFFFFFFF;

  for (let b of bytes){
    crc = (crc>>>8)^table[(crc^b)&0xFF];
  }

  return (crc^0xFFFFFFFF)>>>0;
}

/**************** WORD ENCODE ****************/
function wordToCode(w){
  let C=0n;
  let p=0;

  for(let i=w.length-1;i>=0 && p<LMAX;i--){
    const idx = charToIndex[w[i]] || 0;
    C += BigInt(idx) * (BigInt(B) ** BigInt(p));
    p++;
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

/**************** IMAGE LAYER ****************/
function drawByte(buf, p, v){
  const gray = 255 - v;
  const i = p*4;
  buf[i]=gray; buf[i+1]=gray; buf[i+2]=gray; buf[i+3]=255;
}

function readByte(data, p){
  return 255 - data[p*4];
}

/**************** UI ****************/
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const btnEncode = document.getElementById("btnEncode");
const btnDecode = document.getElementById("btnDecode");

const statusEncode = document.getElementById("statusEncode");
const statusDecode = document.getElementById("statusDecode");
const outputText = document.getElementById("outputText");

/**************** ENCODE ****************/
btnEncode.onclick = async () => {
  try{
    const file = document.getElementById("docInput").files[0];
    if(!file) return alert("اختر ملف");

    let text = await file.text();
    text = cleanText(text);

    const crc = crc32(text);
    const key = BigInt(document.getElementById("userKey").value || 0);
    const keyCheck = Number(key % 256n);

    const words = text.split(" ");
    const blocks = [];

    for(const w of words){
      for(let i=0;i<w.length;i+=LMAX){
        blocks.push(w.slice(i,i+LMAX));
      }
    }

    canvas.width = SIZE;
    canvas.height = SIZE;

    const img = ctx.createImageData(SIZE,SIZE);
    const buf = img.data;

    for(let i=0;i<buf.length;i+=4){
      buf[i]=255;buf[i+1]=255;buf[i+2]=255;buf[i+3]=255;
    }

    // header
    let count = BigInt(blocks.length);
    for(let i=0;i<8;i++){
      drawByte(buf,i,Number((count>>(8n*i))&0xFFn));
    }

    for(let i=0;i<4;i++){
      drawByte(buf,8+i,(crc>>(8*i))&0xFF);
    }

    drawByte(buf,HEADER_VERSION_OFFSET,1);
    drawByte(buf,HEADER_KEYCHECK_OFFSET,keyCheck);

    // data
    for(let bi=0;bi<blocks.length;bi++){
      const C = wordToCode(blocks[bi]) ^ key;

      for(let j=0;j<8;j++){
        const byte = Number((C>>(8n*j))&0xFFn);
        drawByte(buf,HEADER+bi*8+j,byte);
      }
    }

    ctx.putImageData(img,0,0);

    statusEncode.textContent = "تم التشفير ✅";
  }catch(e){
    alert(e.message);
  }
};

/**************** DECODE ****************/
btnDecode.onclick = async () => {
  try{
    const file = document.getElementById("imageInput").files[0];
    if(!file) return alert("اختر صورة");

    const img = new Image();
    const url = URL.createObjectURL(file);

    await new Promise(res=>{
      img.onload=res;
      img.src=url;
    });

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img,0,0);

    const data = ctx.getImageData(0,0,SIZE,SIZE).data;

    let count=0n;
    for(let i=0;i<8;i++){
      count |= BigInt(readByte(data,i))<<(8n*i);
    }

    const key = BigInt(document.getElementById("userKey").value || 0);
    const keyCheck = readByte(data,HEADER_KEYCHECK_OFFSET);

    if(Number(key%256n)!==keyCheck){
      alert("المفتاح غير صحيح");
      return;
    }

    const blocks=[];
    for(let bi=0;bi<Number(count);bi++){
      let C=0n;
      for(let j=0;j<8;j++){
        const v = readByte(data,HEADER+bi*8+j);
        C |= BigInt(v)<<(8n*j);
      }
      blocks.push(codeToWord(C ^ key));
    }

    const text = blocks.join(" ");
    outputText.textContent = text;

    statusDecode.textContent = "تم فك التشفير ✅";
  }catch(e){
    alert(e.message);
  }
};
