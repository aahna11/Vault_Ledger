import request from 'supertest';import app from '../index.js';
const email=`t${Date.now()}@x.com`,password='Str0ngPass1';let tok;
test('unknown email -> EMAIL_NOT_FOUND',async()=>{const r=await request(app).post('/auth/login').send({email:'no@x.com',password});expect(r.status).toBe(404);expect(r.body.error.code).toBe('EMAIL_NOT_FOUND')});
test('signup',async()=>{const r=await request(app).post('/auth/signup').send({email,password});expect(r.status).toBe(201);tok=r.body.accessToken});
test('wrong password -> PASSWORD_INCORRECT with attemptsLeft',async()=>{const r=await request(app).post('/auth/login').send({email,password:'bad'});expect(r.status).toBe(401);expect(r.body.error.attemptsLeft).toBe(4)});
test('lockout after 5 fails',async()=>{let r;for(let i=0;i<4;i++)r=await request(app).post('/auth/login').send({email,password:'bad'});expect(r.status).toBe(423);expect(r.body.error.code).toBe('ACCOUNT_LOCKED')});
test('data gate blocks before import',async()=>{const r=await request(app).get('/accounts').set('Authorization','Bearer '+tok);expect(r.status).toBe(403);expect(r.body.error.code).toBe('DATA_NOT_IMPORTED')});
test('bad header rejected',async()=>{const r=await request(app).post('/import/validate').set('Authorization','Bearer '+tok).attach('file',Buffer.from('a,b\n1,2\n'),'x.csv');expect(r.status).toBe(422)});
