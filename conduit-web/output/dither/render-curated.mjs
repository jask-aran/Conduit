import sharp from 'sharp';
const settings = [
  {id:'black-hole', ink:[255,184,65], density:1.2},
  {id:'jade-coast', ink:[255,232,183], density:1.2},
  {id:'pine-lake', ink:[234,211,255], density:1.3},
  {id:'summer-hills', ink:[242,248,194], density:1.1},
  {id:'peach-tide', ink:[255,208,186], density:1.6},
];
let matrix=[0];
for(let n=1;n<8;n*=2){const next=[];for(let y=0;y<n*2;y++)for(let x=0;x<n*2;x++)next[y*n*2+x]=4*matrix[y%n*n+x%n]+[0,2,3,1][Math.floor(y/n)*2+Math.floor(x/n)];matrix=next;}
for(const {id,ink,density} of settings){
  const {data,info}=await sharp(`output/dither/${id}-clean.png`).resize(1100).removeAlpha().blur(.5).raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const i=(y*info.width+x)*3;
    const luminance=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;
    const coverage=Math.min(.75,density*luminance*luminance);
    if((matrix[y%8*8+x%8]+.5)/64<coverage)for(let k=0;k<3;k++)data[i+k]=ink[k];
  }
  await sharp(data,{raw:{width:info.width,height:info.height,channels:3}}).resize(info.width*2,info.height*2,{kernel:'nearest'}).png().toFile(`src/gallery/assets/${id}-screen.png`);
}
