import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
const items=JSON.parse(await readFile('output/dither/more.json','utf8'));
let b=[0];for(let n=1;n<8;n*=2){const a=[];for(let y=0;y<n*2;y++)for(let x=0;x<n*2;x++)a[y*n*2+x]=4*b[(y%n)*n+x%n]+[0,2,3,1][Math.floor(y/n)*2+Math.floor(x/n)];b=a;}
for(const {id} of items){
const source=sharp(`output/dither/${id}-source.jpg`).resize(800).removeAlpha();
const {data,info}=await source.clone().raw().toBuffer({resolveWithObject:true});
const quantized=await source.clone().png({palette:true,colours:8,dither:0}).toBuffer();
const reduced=await sharp(quantized).removeAlpha().raw().toBuffer();const colors=new Map();for(let i=0;i<reduced.length;i+=3){const c=[reduced[i],reduced[i+1],reduced[i+2]];colors.set(c.join(','),c);}const palette=[...colors.values()];
const screen=Buffer.from(data);
for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
 const i=(y*info.width+x)*3,r=[data[i],data[i+1],data[i+2]],threshold=(b[y%8*8+x%8]+.5)/64;
 const l=(.2126*r[0]+.7152*r[1]+.0722*r[2])/255,coverage=Math.min(1,.18+Math.pow(l,.7)*.85);
 for(let k=0;k<3;k++)screen[i+k]=threshold<coverage?r[k]:8;
 let best=Infinity,chosen=palette[0];
 for(let a=0;a<palette.length;a++)for(let z=a+1;z<palette.length;z++){
 const p=palette[a],q=palette[z],d=q.map((v,k)=>v-p[k]),t=Math.max(0,Math.min(1,d.reduce((sum,v,k)=>sum+(r[k]-p[k])*v,0)/d.reduce((sum,v)=>sum+v*v,0)));
 const error=d.reduce((sum,v,k)=>sum+(r[k]-p[k]-t*v)**2,0);if(error<best){best=error;chosen=t>threshold?q:p;}
 }for(let k=0;k<3;k++)data[i+k]=chosen[k];
}
for(const [pixels,suffix] of [[data,''],[screen,'-screen']])await sharp(pixels,{raw:{width:info.width,height:info.height,channels:3}}).resize(info.width*2,info.height*2,{kernel:'nearest'}).png().toFile(`src/gallery/assets/${id}${suffix}.png`);
console.log(id,palette.length);
}
