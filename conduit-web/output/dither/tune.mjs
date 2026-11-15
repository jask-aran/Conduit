import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
const more=JSON.parse(await readFile('output/dither/more.json','utf8'));
const settings=[
 {id:'orange',width:1100,grid:8,density:.12,ink:[12,10,10],mix:.5},
 {id:'marble',width:1400,grid:4,density:.07,ink:[19,16,15],mix:.45},
 {id:'ribbons',width:1100,grid:8,density:.10,ink:[235,218,240],mix:.4},
 {id:'mountains',width:1200,grid:4,density:.09,ink:[248,225,218],mix:.45},
 {id:'pink-teal',width:1300,grid:4,density:.08,ink:[189,229,220],mix:.35},
 {id:'nebula',width:1400,grid:4,density:.07,ink:[177,218,220],mix:.4},
 {id:'forest-sunset',width:1200,grid:8,density:.10,ink:[255,212,186],mix:.45},
 {id:'mountain-light',width:1100,grid:8,density:.12,ink:[255,224,214],mix:.45},
 {id:'cloud-meadow',width:1200,grid:8,density:1,ink:[207,232,255],mix:.35},
 {id:'violet-nebula',width:1400,grid:4,density:.07,ink:[181,211,245],mix:.35},
];
for(const setting of settings){
 const {id,width,grid,density,ink,mix}=setting;
 const path=id==='mountains'?'/mnt/c/Users/jaska/AppData/Local/Temp/tmpADFC.png':`output/dither/${id}-source.jpg`;
 const source=sharp(path).resize(width).removeAlpha().blur(.5);
 const {data,info}=await source.clone().raw().toBuffer({resolveWithObject:true});const screen=Buffer.from(data);
 const q=await source.clone().png({palette:true,colours:16,dither:0}).toBuffer();const reduced=await sharp(q).removeAlpha().raw().toBuffer();const colors=new Map();
 for(let i=0;i<reduced.length;i+=3){const c=[reduced[i],reduced[i+1],reduced[i+2]];colors.set(c.join(','),c);}const palette=[...colors.values()];
 let b=[0];for(let n=1;n<grid;n*=2){const a=[];for(let y=0;y<n*2;y++)for(let x=0;x<n*2;x++)a[y*n*2+x]=4*b[(y%n)*n+x%n]+[0,2,3,1][Math.floor(y/n)*2+Math.floor(x/n)];b=a;}
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
 const i=(y*info.width+x)*3,r=[data[i],data[i+1],data[i+2]],threshold=(b[y%grid*grid+x%grid]+.5)/(grid*grid);
 const l=(.2126*r[0]+.7152*r[1]+.0722*r[2])/255;
 const lightInk=ink[0]+ink[1]+ink[2]>384;
 const coverage=density*(lightInk?l*l:(1-l)*(1-l));
 if(threshold<coverage)for(let k=0;k<3;k++)screen[i+k]=ink[k];
 const distances=palette.map((color,index)=>({index,distance:color.reduce((sum,v,k)=>sum+(r[k]-v)**2,0)})).sort((a,b)=>a.distance-b.distance);
 const p=palette[distances[0].index],q=palette[distances[1].index],d=q.map((v,k)=>v-p[k]);
 const t=Math.max(0,Math.min(1,d.reduce((sum,v,k)=>sum+(r[k]-p[k])*v,0)/d.reduce((sum,v)=>sum+v*v,0)));
 const chosen=t>.5+(threshold-.5)*mix?q:p;
 for(let k=0;k<3;k++)data[i+k]=chosen[k];
 }
 for(const [pixels,suffix]of[[data,''],[screen,'-screen']])await sharp(pixels,{raw:{width:info.width,height:info.height,channels:3}}).resize(info.width*2,info.height*2,{kernel:'nearest'}).png().toFile(`src/gallery/assets/${id}${suffix}.png`);
 console.log(id,JSON.stringify({grid,density,ink,width}));
}
