
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}}
const C=(await import('./src/engine/content.js')).default
console.log('keys:', Object.keys(C).filter(k=>/MATERIAL|mat/i.test(k)))
console.log('matName(theme_essence)=', C.matName && C.matName('theme_essence'))
console.log('matName(rename_card)=', C.matName && C.matName('rename_card'))
console.log('info essence:', JSON.stringify(C.materialInfo && C.materialInfo('theme_essence')))
