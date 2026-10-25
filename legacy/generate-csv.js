import fs from 'fs';
let s=42;const r=()=>(s=(s*1664525+1013904223)%4294967296)/4294967296;
const acc=['Operating','Payroll','Rent Reserve','Vendor Pool','Tax Vault','UPI Collections','Savings','Petty Cash'];
const bal=Object.fromEntries(acc.map(a=>[a,0]));const rows=[];const d0=new Date('2026-08-01');
const day=i=>new Date(d0.getTime()+i*864e5).toISOString().slice(0,10);
acc.forEach(a=>{const p=(500000+Math.floor(r()*500000))*100;bal[a]+=p;rows.push(['TXN'+String(rows.length+1).padStart(5,'0'),day(0),'OPENING','SYSTEM_EQUITY',a,(p/100).toFixed(2),'Opening balance']);});
const nar=['Office rent','Salary credit','Vendor payment','UPI refund','GST payment','Electricity bill','Client invoice settlement','Internet bill'];
while(rows.length<130){const f=acc[Math.floor(r()*8)],t=acc[Math.floor(r()*8)];if(f===t)continue;const paise=Math.floor(r()*4000000)+5000;if(bal[f]<paise)continue;bal[f]-=paise;bal[t]+=paise;
rows.push(['TXN'+String(rows.length+1).padStart(5,'0'),day(1+Math.floor((rows.length-8)*59/122)),'TRANSFER',f,t,(paise/100).toFixed(2),nar[Math.floor(r()*8)]]);}
fs.mkdirSync('sample-data',{recursive:true});
const w=(f,h,x)=>fs.writeFileSync('sample-data/'+f,[h,...x.map(a=>a.join(','))].join('\n')+'\n');
w('vaultledger_sample_ledger.csv','txn_ref,date,type,from_account,to_account,amount_inr,narration',rows);
const tr=rows.filter(x=>x[2]==='TRANSFER');const bank=tr.map(x=>['BNK'+x[0].slice(3),x[1],x[5],x[3],x[6]]);
bank.splice(5,3);bank[10][2]=(+bank[10][2]+10).toFixed(2);bank[20][2]=(+bank[20][2]+5).toFixed(2);bank.push([...bank[30]],[...bank[40]]);
w('bank_statement.csv','bank_ref,date,amount_inr,account,description',bank);
console.log('CSVs written to sample-data/');
