
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}}
const C=(await import('./src/engine/content.js')).default
for(const p of C.SHOP_PRODUCTS) console.log(JSON.stringify({id:p.id,price:p.price,grants:p.grants}))
process.exit(0)
