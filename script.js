/****************************************************
 * ALM HYBRID ENGINE v1
 * Byte + Position Encoding (Stable Upgrade)
 ****************************************************/

// ================= SETTINGS =================
const B=32, LMAX=12, SIZE=1024, HEADER=32;

// HEADER STRUCTURE
// [0..7]   = block count
// [8..11]  = CRC32
// [12]     = mode (1=byte , 2=hybrid)
// [13..31] = reserved

const HEADER_CRC_OFFSET = 8;
const HEADER_MODE_OFFSET = 12;

// ================= CHAR TABLE =================
const indexToChar={
  1:"ا",2:"ب",3:"ت",4:"ث",5:"ج",6:"ح",7:"خ",8:"د",9:"ذ",
  10:"ر",11:"ز",12:"س",13:"ش",14:"ص",15:"ض",16:"ط",
  17:"ظ",18:"ع",19:"غ",20:"ف",21:"ق",22:"ك",23:"ل",
  24:"م",25:"ن",26:"ه",27:"و",28:"ي",29:"ء"
};

const charToIndex={};
for (let k in indexToChar) charToIndex[indexToChar[k]] = Number(k);

// ================= TEXT =================
function normalizeArabic(s){
  return (s||"")
    .replace(/[إأآ]/g,"ا")
    .replace(/ى/g,"ي")
    .replace(/ة/g,"ه")
    .replace(/ئ/g,"ي");
}

function cleanText(t){
  t = normalizeArabic(t);
  let out="";
  for(const ch of t){
    if(ch===" "||ch==="\n") out+=" ";
    else if(charToIndex[ch]) out+=ch;
  }
  return out.replace(/\s+/g," ").trim();
}

// ================= CRC32 =================
function crc32(str){
  const table = crc32.table || (crc32.table = (() => {
    let t=[];
    for(let i=0;i<256;i++){
      let c=i;
      for(let k=0;k<8;k++){
        c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
      }
      t[i]=c>>>0;
    }
    return t;
  })());

  const bytes=new TextEncoder().encode(str);
  let crc=0xFFFFFFFF;
  for(let b of bytes){
    crc=(crc>>>8)^table[(crc^b)&0xFF];
  }
  return (crc^0xFFFFFFFF)>>>0;
}

// ================= WORD CODE =================
function wordToCode(w){
  let C=0n, p=0;
  for(let i=w.length-1;i>=0;i--){
    let idx=charToIndex[w[i]];
    if(!idx) continue;
    C += BigInt(idx)*(BigInt(B)**BigInt(p));
    p++;
    if(p>=LMAX) break;
  }
  return C;
}

function codeToWord(C){
  let out="";
  for(let i=0;i<LMAX;i++){
    let d=Number(C%BigInt(B));
    C/=BigInt(B);
    if(d) out=indexToChar[d]+out;
  }
  return out;
}

// ================= BYTE =================
function getByte(C,i){
  return Number((C>>BigInt(8*i))&0xFFn);
}

// ================= DRAW =================
function drawByte(buf,p,val){
  let g=255-(val&255);
  let i=p*4;
  buf[i]=buf[i+1]=buf[i+2]=g;
  buf[i+3]=255;
}

function readByte(data,p){
  return 255-data[p*4];
}

// ================= POSITION ENCODING =================
function encodePosition(n){
  const x = Number(n % BigInt(SIZE));
  const y = Number(n / BigInt(SIZE));
  return {x,y};
}

function decodePosition(x,y){
  return BigInt(y)*BigInt(SIZE)+BigInt(x);
}

// ================= GLOBAL =================
let lastDecodedText="";

// ================= ENCODE =================
btnEncode.onclick = async ()=>{
  try{
    const file = document.getElementById("docInput").files[0];
    if(!file) return alert("اختر ملف");

    let text = await extractText(file);
    text = cleanText(text);

    const key = BigInt(userKey.value||0);
    const crc = crc32(text);

    const words=text.split(" ");
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

    buf.fill(255);

    // HEADER
    let count=BigInt(blocks.length);
    for(let i=0;i<8;i++) drawByte(buf,i,Number((count>>BigInt(8*i))&255n));
    for(let i=0;i<4;i++) drawByte(buf,HEADER_CRC_OFFSET+i,(crc>>(8*i))&255);

    drawByte(buf,HEADER_MODE_OFFSET,2); // HYBRID MODE

    let ptr=HEADER;

    for(let b of blocks){
      let C=wordToCode(b)^key;

      // BYTE STORE
      for(let j=0;j<8;j++){
        drawByte(buf,ptr++,getByte(C,j));
      }

      // POSITION STORE
      let pos=encodePosition(C);
      let pixelIndex = pos.y*SIZE + pos.x;
      let idx = pixelIndex*4;

      buf[idx]=0; buf[idx+1]=255; buf[idx+2]=0; buf[idx+3]=255;
    }

    ctx.putImageData(img,0,0);

    statusEncode.textContent="تم التشفير HYBRID ✅";
  }catch(e){
    alert(e.message);
  }
};

// ================= DECODE =================
btnDecode.onclick = async ()=>{
  try{
    const file=imageInput.files[0];
    if(!file) return alert("اختر صورة");

    const key = BigInt(userKey.value||0);

    const img=new Image();
    img.src=URL.createObjectURL(file);
    await img.decode();

    const canvas=document.getElementById("canvas");
    canvas.width=img.width;
    canvas.height=img.height;

    const ctx=canvas.getContext("2d");
    ctx.drawImage(img,0,0);

    const data=ctx.getImageData(0,0,SIZE,SIZE).data;

    // READ COUNT
    let count=0n;
    for(let i=0;i<8;i++){
      count|=BigInt(readByte(data,i))<<(BigInt(8*i));
    }

    let mode = readByte(data,HEADER_MODE_OFFSET);

    let blocks=[];
    let ptr=HEADER;

    if(mode===2){
      // HYBRID
      for(let i=0;i<Number(count);i++){
        let C=0n;

        for(let j=0;j<8;j++){
          let v=readByte(data,ptr++);
          C|=BigInt(v)<<(BigInt(8*j));
        }

        let w=codeToWord(C^key);
        if(w) blocks.push(w);
      }
    }

    let text=blocks.join(" ");
    lastDecodedText=text;
    outputText.textContent=text;

    statusDecode.textContent="تم فك HYBRID ✅";

  }catch(e){
    alert(e.message);
  }
};
