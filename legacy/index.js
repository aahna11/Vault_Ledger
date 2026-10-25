import 'dotenv/config';import express from 'express';import mysql from 'mysql2/promise';import bcrypt from 'bcrypt';import jwt from 'jsonwebtoken';
import {z} from 'zod';import multer from 'multer';import {parse} from 'csv-parse/sync';import crypto from 'crypto';import cookieParser from 'cookie-parser';
import helmet from 'helmet';import rateLimit from 'express-rate-limit';import cors from 'cors';import fs from 'fs';
const pool=mysql.createPool({uri:process.env.DATABASE_URL,connectionLimit:10});const SEC=process.env.JWT_SECRET||'dev';
const app=express();app.use(helmet(),cors({origin:true,credentials:true}),express.json({limit:'64kb'}),cookieParser());
const E=(res,s,code,message,x={})=>res.status(s).json({error:{code,message,...x}});
const audit=(uid,action,meta={})=>pool.query('INSERT INTO audit_log(user_id,action,meta) VALUES(?,?,?)',[uid,action,JSON.stringify(meta)]);
const lim=rateLimit({windowMs:60000,limit:process.env.NODE_ENV==='test'?1e6:60});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const mk=u=>jwt.sign({uid:u.id,role:u.role},SEC,{expiresIn:'15m'});
const wrap=f=>(q,s,n)=>f(q,s,n).catch(e=>{console.error(e);E(s,500,'INTERNAL',e.message)});
const auth=(q,s,n)=>{try{const t=jwt.verify((q.headers.authorization||'').slice(7),SEC);q.uid=t.uid;q.role=t.role;n()}catch{E(s,401,'UNAUTHORIZED','Login required')}};
const gate=wrap(async(q,s,n)=>{const[[d]]=await pool.query('SELECT id FROM datasets WHERE user_id=? LIMIT 1',[q.uid]);d?n():E(s,403,'DATA_NOT_IMPORTED','Import a ledger CSV first')});
async function issue(res,u){const rt=crypto.randomBytes(32).toString('hex');
 await pool.query('INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))',[u.id,sha(rt)]);
 res.cookie('rt',rt,{httpOnly:true,sameSite:'lax',maxAge:6048e5});return{accessToken:mk(u),user:{id:u.id,email:u.email,role:u.role}}}
app.get('/health',(q,s)=>s.json({ok:true}));
const pw=z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/);
app.post('/auth/signup',lim,wrap(async(q,s)=>{const p=z.object({email:z.string().email(),password:pw}).safeParse(q.body);
 if(!p.success)return E(s,400,'VALIDATION','Password needs 8+ chars with upper, lower and a digit',{details:p.error.issues});
 const[[x]]=await pool.query('SELECT id FROM users WHERE email=?',[p.data.email]);if(x)return E(s,409,'EMAIL_TAKEN','Email already registered');
 const[r]=await pool.query('INSERT INTO users(email,password_hash) VALUES(?,?)',[p.data.email,await bcrypt.hash(p.data.password,12)]);
 await audit(r.insertId,'SIGNUP');s.status(201).json(await issue(s,{id:r.insertId,email:p.data.email,role:'user'}))}));
app.post('/auth/login',lim,wrap(async(q,s)=>{const{email,password}=q.body||{};const[[u]]=await pool.query('SELECT * FROM users WHERE email=?',[email||'']);
 if(!u){await audit(null,'LOGIN_UNKNOWN_EMAIL',{email});return E(s,404,'EMAIL_NOT_FOUND','Email not registered')}
 if(u.locked_until&&new Date(u.locked_until)>new Date()){await audit(u.id,'LOGIN_BLOCKED_LOCKED');return E(s,423,'ACCOUNT_LOCKED','Account locked',{retryAfter:Math.ceil((new Date(u.locked_until)-Date.now())/1000)})}
 if(u.locked_until){u.failed_attempts=0;await pool.query('UPDATE users SET locked_until=NULL,failed_attempts=0 WHERE id=?',[u.id])}
 if(!await bcrypt.compare(password||'',u.password_hash)){const f=u.failed_attempts+1;await audit(u.id,'LOGIN_FAILED',{attempt:f});
  if(f>=5){await pool.query('UPDATE users SET failed_attempts=0,locked_until=DATE_ADD(NOW(),INTERVAL 15 MINUTE) WHERE id=?',[u.id]);await audit(u.id,'ACCOUNT_LOCKED');return E(s,423,'ACCOUNT_LOCKED','Too many attempts',{retryAfter:900})}
  await pool.query('UPDATE users SET failed_attempts=? WHERE id=?',[f,u.id]);return E(s,401,'PASSWORD_INCORRECT','Wrong password',{attemptsLeft:5-f})}
 await pool.query('UPDATE users SET failed_attempts=0 WHERE id=?',[u.id]);await audit(u.id,'LOGIN_OK');s.json(await issue(s,u))}));
app.post('/auth/refresh',wrap(async(q,s)=>{const rt=q.cookies.rt;if(!rt)return E(s,401,'NO_REFRESH','No refresh token');
 const[[t]]=await pool.query('SELECT u.* FROM refresh_tokens r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>NOW()',[sha(rt)]);
 if(!t)return E(s,401,'BAD_REFRESH','Invalid refresh');s.json({accessToken:mk(t),user:{id:t.id,email:t.email,role:t.role}})}));
app.post('/auth/logout',wrap(async(q,s)=>{if(q.cookies.rt)await pool.query('DELETE FROM refresh_tokens WHERE token_hash=?',[sha(q.cookies.rt)]);s.clearCookie('rt').json({ok:true})}));
app.get('/me',auth,wrap(async(q,s)=>{const[[u]]=await pool.query('SELECT id,email,role FROM users WHERE id=?',[q.uid]);
 const[[d]]=await pool.query('SELECT id FROM datasets WHERE user_id=? LIMIT 1',[q.uid]);const[[st]]=await pool.query('SELECT user_id FROM user_session_state WHERE user_id=?',[q.uid]);
 s.json({user:u,datasetImported:!!d,hasSavedState:!!st})}));
const up=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
app.get('/import/sample/:f',(q,s)=>{const m={'ledger.csv':'vaultledger_sample_ledger.csv','bank-statement.csv':'bank_statement.csv'}[q.params.f];
 m&&fs.existsSync('sample-data/'+m)?s.download('sample-data/'+m):E(s,404,'NOT_FOUND','Run npm run generate:csv')});
function validate(buf){const err=[];let rec;try{rec=parse(buf,{columns:true,skip_empty_lines:true,trim:true})}catch(e){return{err:[{row:0,field:'file',reason:'Unparseable CSV'}]}}
 const H='txn_ref,date,type,from_account,to_account,amount_inr,narration'.split(',');const got=Object.keys(rec[0]||{});
 if(H.some(h=>!got.includes(h)))return{err:[{row:1,field:'header',reason:'Expected '+H.join(',')}]};
 if(rec.length>5000)return{err:[{row:0,field:'file',reason:'Max 5000 rows'}]};
 const seen=new Set(),rows=[];
 rec.forEach((x,i)=>{const n=i+2,bad=(f,r)=>err.push({row:n,field:f,reason:r});
  if(!x.txn_ref)bad('txn_ref','required');else if(seen.has(x.txn_ref))bad('txn_ref','duplicate');seen.add(x.txn_ref);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||isNaN(new Date(x.date)))bad('date','invalid date');
  if(!['OPENING','TRANSFER'].includes(x.type))bad('type','must be OPENING or TRANSFER');
  if(!x.from_account||!x.to_account)bad('account','required');else if(x.from_account===x.to_account)bad('to_account','from and to must differ');
  if(!/^\d+(\.\d{1,2})?$/.test(x.amount_inr)||+x.amount_inr<=0)bad('amount_inr','must be positive with max 2 decimals');
  rows.push({...x,i,paise:Math.round(parseFloat(x.amount_inr)*100)})});
 if(err.length)return{err};
 rows.sort((a,b)=>a.date.localeCompare(b.date)||a.i-b.i);const bal={};
 for(const x of rows){if(x.type!=='OPENING'){if((bal[x.from_account]||0)<x.paise){err.push({row:x.i+2,field:'amount_inr',reason:`overdraft on ${x.from_account}`});continue}bal[x.from_account]-=x.paise}
  bal[x.to_account]=(bal[x.to_account]||0)+x.paise}
 return{err,rows}}
const imp=commit=>wrap(async(q,s)=>{if(!q.file)return E(s,400,'NO_FILE','Upload a CSV');const hash=sha(q.file.buffer);
 const[[dup]]=await pool.query('SELECT id FROM datasets WHERE user_id=? AND file_hash=?',[q.uid,hash]);
 if(dup)return s.json({ok:true,idempotent:true,message:'This file was already imported. Nothing changed.'});
 const[[any]]=await pool.query('SELECT id FROM datasets WHERE user_id=? LIMIT 1',[q.uid]);if(any&&commit)return E(s,409,'ALREADY_IMPORTED','A dataset already exists');
 const v=validate(q.file.buffer);if(v.err.length){await audit(q.uid,'IMPORT_REJECTED',{errors:v.err.length});return E(s,422,'IMPORT_INVALID','Validation failed',{details:v.err})}
 if(!commit)return s.json({ok:true,rows:v.rows.length,preview:v.rows.slice(0,20)});
 const c=await pool.getConnection();try{await c.beginTransaction();await c.query('INSERT INTO datasets(user_id,file_hash) VALUES(?,?)',[q.uid,hash]);const ids={};
  for(const x of v.rows)for(const n of[x.from_account,x.to_account])if(!ids[n]){const[r]=await c.query('INSERT INTO accounts(user_id,name,is_system) VALUES(?,?,?)',[q.uid,n,n==='SYSTEM_EQUITY'?1:0]);ids[n]=r.insertId}
  for(const x of v.rows){const[t]=await c.query('INSERT INTO transactions(user_id,txn_ref,date,type,narration,amount_paise) VALUES(?,?,?,?,?,?)',[q.uid,x.txn_ref,x.date,x.type,x.narration,x.paise]);
   await c.query('INSERT INTO ledger_entries(txn_id,account_id,direction,amount_paise) VALUES(?,?,"DEBIT",?),(?,?,"CREDIT",?)',[t.insertId,ids[x.from_account],x.paise,t.insertId,ids[x.to_account],x.paise]);
   await c.query('UPDATE accounts SET balance_paise=balance_paise-? WHERE id=?',[x.paise,ids[x.from_account]]);await c.query('UPDATE accounts SET balance_paise=balance_paise+? WHERE id=?',[x.paise,ids[x.to_account]])}
  await c.commit();await audit(q.uid,'IMPORT_OK',{rows:v.rows.length});s.json({ok:true,rows:v.rows.length})}catch(e){await c.rollback();throw e}finally{c.release()}});
app.post('/import/validate',auth,lim,up.single('file'),imp(false));app.post('/import/confirm',auth,lim,up.single('file'),imp(true));
app.get('/accounts',auth,gate,wrap(async(q,s)=>{const[r]=await pool.query('SELECT id,name,is_system,balance_paise FROM accounts WHERE user_id=? ORDER BY is_system,name',[q.uid]);s.json(r)}));
app.get('/accounts/:id/ledger',auth,gate,wrap(async(q,s)=>{const pg=Math.max(1,+q.query.page||1),n=20;const[[a]]=await pool.query('SELECT id FROM accounts WHERE id=? AND user_id=?',[q.params.id,q.uid]);if(!a)return E(s,404,'NOT_FOUND','No such account');
 const[r]=await pool.query('SELECT t.id,t.txn_ref,t.date,t.narration,t.reversed_by,e.direction,e.amount_paise FROM ledger_entries e JOIN transactions t ON t.id=e.txn_id WHERE e.account_id=? ORDER BY t.date DESC,t.id DESC LIMIT ? OFFSET ?',[a.id,n,(pg-1)*n]);s.json({page:pg,items:r})}));
async function move(c,uid,from,to,paise,ref,narr,type,idem,ph){
 const ids=[from,to].sort((a,b)=>a-b);const[ac]=await c.query('SELECT id,balance_paise,user_id,is_system FROM accounts WHERE id IN(?,?) ORDER BY id FOR UPDATE',ids);
 if(ac.length!==2||ac.some(a=>a.user_id!==uid))throw{s:404,code:'NOT_FOUND',m:'Account not found'};
 const f=ac.find(a=>a.id===from);if(!f.is_system&&f.balance_paise<paise)throw{s:422,code:'INSUFFICIENT_FUNDS',m:'Insufficient funds'};
 const[t]=await c.query('INSERT INTO transactions(user_id,txn_ref,date,type,narration,amount_paise,idem_key,payload_hash) VALUES(?,?,CURDATE(),?,?,?,?,?)',[uid,ref,type,narr,paise,idem,ph]);
 await c.query('INSERT INTO ledger_entries(txn_id,account_id,direction,amount_paise) VALUES(?,?,"DEBIT",?),(?,?,"CREDIT",?)',[t.insertId,from,paise,t.insertId,to,paise]);
 await c.query('UPDATE accounts SET balance_paise=balance_paise-? WHERE id=?',[paise,from]);await c.query('UPDATE accounts SET balance_paise=balance_paise+? WHERE id=?',[paise,to]);return t.insertId}
const tx=async fn=>{const c=await pool.getConnection();try{await c.beginTransaction();const r=await fn(c);await c.commit();return r}catch(e){await c.rollback();throw e}finally{c.release()}};
const fail=(s,e)=>e.code?E(s,e.s,e.code,e.m):(console.error(e),E(s,500,'INTERNAL',e.message));
app.post('/transfers',auth,gate,lim,async(q,s)=>{const key=q.headers['idempotency-key'];if(!key)return E(s,400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key header required');
 const p=z.object({from:z.number().int(),to:z.number().int(),amountPaise:z.number().int().positive(),narration:z.string().max(200).optional()}).refine(x=>x.from!==x.to).safeParse(q.body);if(!p.success)return E(s,400,'VALIDATION','Invalid transfer',{details:p.error.issues});
 const ph=sha(JSON.stringify(p.data));try{const out=await tx(async c=>{const[[ex]]=await c.query('SELECT payload_hash,response_json FROM transactions WHERE user_id=? AND idem_key=?',[q.uid,key]);
  if(ex){if(ex.payload_hash!==ph)throw{s:409,code:'IDEMPOTENCY_CONFLICT',m:'Key reused with different payload'};return typeof ex.response_json==='string'?JSON.parse(ex.response_json):ex.response_json}
  const id=await move(c,q.uid,p.data.from,p.data.to,p.data.amountPaise,'TR-'+crypto.randomUUID().slice(0,12),p.data.narration||'Transfer','TRANSFER',key,ph);
  const resp={id,status:'PAID'};await c.query('UPDATE transactions SET response_json=? WHERE id=?',[JSON.stringify(resp),id]);await audit(q.uid,'TRANSFER',{id});return resp});s.status(201).json(out)}catch(e){fail(s,e)}});
app.post('/transfers/:id/reverse',auth,gate,async(q,s)=>{try{const out=await tx(async c=>{const[[t]]=await c.query('SELECT * FROM transactions WHERE id=? AND user_id=? FOR UPDATE',[q.params.id,q.uid]);
  if(!t)throw{s:404,code:'NOT_FOUND',m:'No such transaction'};if(t.reversed_by)throw{s:409,code:'ALREADY_REVERSED',m:'Already reversed'};if(t.type==='REVERSAL')throw{s:409,code:'NOT_REVERSIBLE',m:'Cannot reverse a reversal'};
  const[es]=await c.query('SELECT account_id,direction FROM ledger_entries WHERE txn_id=?',[t.id]);const from=es.find(e=>e.direction==='CREDIT').account_id,to=es.find(e=>e.direction==='DEBIT').account_id;
  const id=await move(c,q.uid,from,to,t.amount_paise,'REV-'+t.txn_ref,'Reversal of '+t.txn_ref,'REVERSAL',null,null);await c.query('UPDATE transactions SET reversed_by=? WHERE id=?',[id,t.id]);await audit(q.uid,'REVERSAL',{id:t.id});return{id,status:'REVERSED'}});s.json(out)}catch(e){fail(s,e)}});
app.get('/session/state',auth,wrap(async(q,s)=>{const[[r]]=await pool.query('SELECT last_route,state_json,version,updated_at FROM user_session_state WHERE user_id=?',[q.uid]);r?s.json(r):E(s,404,'NO_STATE','None')}));
app.put('/session/state',auth,wrap(async(q,s)=>{const p=z.object({route:z.string().max(200),version:z.number().int().min(0),state:z.record(z.any())}).safeParse(q.body);if(!p.success)return E(s,400,'VALIDATION','Bad state');
 const js=JSON.stringify(p.data.state);if(js.length>65536)return E(s,413,'TOO_LARGE','Max 64KB');
 if(p.data.version===0){try{await pool.query('INSERT INTO user_session_state(user_id,last_route,state_json,version) VALUES(?,?,?,1)',[q.uid,p.data.route,js]);return s.json({version:1})}catch{return E(s,409,'VERSION_CONFLICT','State changed elsewhere')}}
 const[r]=await pool.query('UPDATE user_session_state SET last_route=?,state_json=?,version=version+1 WHERE user_id=? AND version=?',[p.data.route,js,q.uid,p.data.version]);
 r.affectedRows?s.json({version:p.data.version+1}):E(s,409,'VERSION_CONFLICT','State changed elsewhere')}));
app.delete('/session/state',auth,wrap(async(q,s)=>{await pool.query('DELETE FROM user_session_state WHERE user_id=?',[q.uid]);s.json({ok:true})}));
app.get('/audit',auth,wrap(async(q,s)=>{if(q.role!=='admin')return E(s,403,'FORBIDDEN','Admin only');const[r]=await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');s.json(r)}));
app.post('/reconciliation/upload',auth,gate,lim,up.single('file'),wrap(async(q,s)=>{if(!q.file)return E(s,400,'NO_FILE','Upload bank CSV');
 let rec;try{rec=parse(q.file.buffer,{columns:true,skip_empty_lines:true,trim:true})}catch{return E(s,422,'BAD_CSV','Unparseable CSV')}
 if(rec.length&&!['bank_ref','date','amount_inr'].every(k=>k in rec[0]))return E(s,422,'BAD_HEADER','Expected bank_ref,date,amount_inr,account,description');
 const[l]=await pool.query("SELECT txn_ref,amount_paise FROM transactions WHERE user_id=? AND type='TRANSFER' AND txn_ref LIKE 'TXN%'",[q.uid]);
 const key=r=>r.replace(/^\D+/,'');const led=new Map(l.map(x=>[key(x.txn_ref),x]));const seen=new Set();const out={matched:[],missing:[],amount_mismatch:[],duplicate:[]};
 for(const b of rec){const k=key(b.bank_ref);if(seen.has(k)){out.duplicate.push(b.bank_ref);continue}seen.add(k);const x=led.get(k);const p=Math.round(parseFloat(b.amount_inr)*100);
  if(!x)continue;p===Number(x.amount_paise)?out.matched.push(b.bank_ref):out.amount_mismatch.push({bank_ref:b.bank_ref,bank:p,ledger:Number(x.amount_paise)})}
 for(const[k,x]of led)if(!seen.has(k))out.missing.push(x.txn_ref);
 await audit(q.uid,'RECONCILIATION',{matched:out.matched.length});s.json({summary:Object.fromEntries(Object.entries(out).map(([a,v])=>[a,v.length])),...out})}));
export default app;
if(process.env.NODE_ENV!=='test')app.listen(process.env.PORT||4000,()=>console.log('API on :'+(process.env.PORT||4000)));
