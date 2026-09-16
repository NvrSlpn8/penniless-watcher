import test from 'node:test';
import assert from 'node:assert/strict';
const a = await import('./agent.mjs').catch(() => ({}));
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,mkdtempSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const config = {baseWallet:'',solanaWallet:''};
test('CLI writes bounded local status with runtime timestamp and no earnings claim',(t)=>{
 const dir=mkdtempSync(join(tmpdir(),'penniless-test-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 copyFileSync(new URL('./agent.mjs',import.meta.url),join(dir,'agent.mjs'));
 writeFileSync(join(dir,'config.json'),JSON.stringify(config));
 writeFileSync(join(dir,'ledger.json'),JSON.stringify({approvedPRs:[]}));
 const env={...process.env,SUPERTEAM_API_KEY:'',GITHUB_ACTIONS:''};
 const before=Date.now();
 const run=spawnSync(process.execPath,['agent.mjs'],{cwd:dir,env,encoding:'utf8',timeout:10000});
 assert.equal(run.status,0);assert.equal(run.stderr,'');assert.match(run.stdout,/Status written/);
 assert.ok(existsSync(join(dir,'status.json')));
 const status=JSON.parse(readFileSync(join(dir,'status.json'),'utf8'));
 assert.ok(Date.parse(status.generatedAt)>=before);assert.equal(status.runtimeSource,'LOCAL');
 assert.equal(status.balances.base.status,'NOT_CONFIGURED');assert.equal(status.balances.solana.status,'NOT_CONFIGURED');assert.equal(status.listings.status,'PENDING_REGISTRATION');assert.deepEqual(status.prs,[]);assert.equal(status.earnings.status,'NOT_VERIFIED');
 const md=readFileSync(join(dir,'status.md'),'utf8');assert.match(md,/NOT_CONFIGURED/);assert.match(md,/not income/i);assert.match(md,/LIMITED_SLICE_MAX_50/);
});
const response = x => new Response(JSON.stringify(x));
test('fixed-destination transport bounds requests and hides remote failures', async () => {
 assert.equal(typeof a.requestJSON,'function');
 let calls=0;
 const fetcher=async(url,opts)=>{calls++; assert.equal(url,'https://mainnet.base.org');assert.equal(opts.redirect,'error');assert.ok(opts.signal);return response({ok:true});};
 assert.deepEqual(await a.requestJSON('base',{method:'eth_call'}, {fetcher}),{ok:true});
 await assert.rejects(a.requestJSON('https://evil.test',{}, {fetcher}),/Request unavailable/);assert.equal(calls,1);
 for(const fetcher of [async()=>new Response('SECRET',{status:500}),async()=>response({large:'x'.repeat(1048576)}),async()=>{throw Error('SECRET');},async()=>new Response('invalid')]) await assert.rejects(a.requestJSON('base',{method:'eth_call'}, {fetcher}),/^Error: Request unavailable$/);
 await assert.rejects(a.requestJSON('base',{method:'eth_call'}, {fetcher:()=>new Promise(()=>{}),timeoutMs:10}),/Request unavailable/);
});
test('transport rejects write RPC methods before any network request',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return response({});};
 for(const [target,method] of [['base','eth_sendRawTransaction'],['solana','sendTransaction'],['base',undefined]]) await assert.rejects(a.requestJSON(target,{method},{fetcher}),/Request unavailable/);
 assert.equal(calls,0);
});
test('Base balance reads exact USDC units without treating errors as zero', async()=>{
 assert.equal(typeof a.readBase,'function');
 assert.deepEqual(await a.readBase('',{fetcher:()=>{throw Error('must not call');}}),{status:'NOT_CONFIGURED'});
 const wallet='0x'+'a'.repeat(40);
 const fetcher=async(url,opts)=>{const p=JSON.parse(opts.body);assert.equal(p.method,'eth_call');assert.equal(p.params[0].to,'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');assert.equal(p.params[0].data,'0x70a08231'+'0'.repeat(24)+wallet.slice(2));return response({jsonrpc:'2.0',id:1,result:'0x'+(900719925474099312345n).toString(16).padStart(64,'0')});};
 assert.deepEqual(await a.readBase(wallet,{fetcher}),{status:'OK',balanceUSDC:'900719925474099.312345',meaning:'BALANCE_NOT_EARNINGS'});
 for(const data of [{error:{message:'secret'}},{result:'0x0'},{jsonrpc:'2.0',id:2,result:'0x'+'0'.repeat(64)}]) assert.deepEqual(await a.readBase(wallet,{fetcher:async()=>response(data)}),{status:'UNKNOWN'});
});
test('Solana sums only validated finalized USDC accounts exactly',async()=>{
 assert.equal(typeof a.readSolana,'function');
 assert.deepEqual(await a.readSolana(''),{status:'NOT_CONFIGURED'});
 const wallet='11111111111111111111111111111111';
 const mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
 const account=(amount,pubkey)=>({pubkey,account:{data:{program:'spl-token',parsed:{type:'account',info:{owner:wallet,mint,tokenAmount:{amount,decimals:6}}}}}});
 const fixture={jsonrpc:'2.0',id:1,result:{context:{slot:1},value:[account('1234567','11111111111111111111111111111111'),account('1','So11111111111111111111111111111111111111112')]}};
 const fetcher=async(url,opts)=>{assert.equal(url,'https://api.mainnet-beta.solana.com');const p=JSON.parse(opts.body);assert.deepEqual(p.params,[wallet,{mint},{encoding:'jsonParsed',commitment:'finalized'}]);return response(fixture);};
 assert.deepEqual(await a.readSolana(wallet,{fetcher}),{status:'OK',balanceUSDC:'1.234568',meaning:'BALANCE_NOT_EARNINGS'});
 fixture.result.value[0].account.data.parsed.info.tokenAmount.decimals=9;
 assert.deepEqual(await a.readSolana(wallet,{fetcher}),{status:'UNKNOWN'});
 fixture.result.value=[];assert.equal((await a.readSolana(wallet,{fetcher})).balanceUSDC,'0.000000');
 fixture.result={};assert.deepEqual(await a.readSolana(wallet,{fetcher}),{status:'UNKNOWN'});
});
test('listings are an untrusted limited slice, never earned rewards',async()=>{
 assert.equal(typeof a.readListings,'function');
 assert.deepEqual(await a.readListings({fetcher:()=>{throw Error();}}),{status:'PENDING_REGISTRATION',scope:'LIMITED_SLICE_MAX_50',items:[]});
 const fixture=[{title:'[click](https://evil.test)\u0000 <b>KEY</b>',slug:'safe-task',agentAccess:'AGENT_ALLOWED',rewardAmount:1000,description:'KEY',status:'OPEN',type:'bounty',deadline:'2099-01-01T00:00:00.000Z',token:'USDC'}];
 const fetcher=async(url,opts)=>{assert.equal(url,'https://superteam.fun/api/agents/listings/live?take=50');assert.equal(opts.method,'GET');assert.equal(opts.headers.Authorization,'Bearer KEY');return response(fixture);};
 const result=await a.readListings({key:'KEY',fetcher});assert.equal(result.status,'OK');assert.equal(result.scope,'LIMITED_SLICE_MAX_50');assert.equal(result.items.length,1);assert.equal(result.items[0].url,'https://superteam.fun/earn/listing/safe-task/');assert.equal(result.items[0].classification,'POTENTIAL_ONLY');
 assert.doesNotMatch(JSON.stringify(result),/KEY|rewardAmount|description|<|\u0000/);assert.doesNotMatch(result.items[0].title,/[\[\]()]/);
 for(const fixture of [{data:[]},{listings:[]},[{title:'x',slug:'../escape',agentAccess:'AGENT_ONLY'}],[{title:'x',slug:'safe',agentAccess:'NEW_VALUE'}],Array(51).fill({title:'x',slug:'safe',agentAccess:'AGENT_ONLY'})]) assert.equal((await a.readListings({key:'KEY',fetcher:async()=>response(fixture)})).status,'UNKNOWN_SCHEMA');
});
test('listing cards preserve deadline and potential pot, including projects',async()=>{
 const fixture=[{title:'Example project',slug:'example-project',agentAccess:'AGENT_ALLOWED',rewardAmount:1000,status:'OPEN',type:'project',deadline:'2099-01-01T00:00:00.000Z',token:'USDC'}];
 const result=await a.readListings({key:'KEY',fetcher:async()=>response(fixture)});
 assert.equal(result.status,'OK');
 assert.equal(result.items[0].deadline,'2099-01-01T00:00:00.000Z');
 assert.equal(result.items[0].potentialPotAmount,1000);assert.equal(result.items[0].token,'USDC');
 fixture[0].token='KEY';assert.equal((await a.readListings({key:'KEY',fetcher:async()=>response(fixture)})).status,'UNKNOWN_SCHEMA');
});
test('PR reads are restricted to explicit approved ledger entries',async()=>{
 assert.equal(typeof a.readPRs,'function');
 assert.deepEqual(await a.readPRs({approvedPRs:[]},{fetcher:()=>{throw Error();}}),[]);
 const url='https://github.com/owner/repo/pull/123';
 const ledger={approvedPRs:[{url,approved:true}]};
 const calls=[];const fetcher=async(url,opts)=>{calls.push(url);assert.equal(opts.method,'GET');assert.equal(opts.headers.Authorization,undefined);return response({number:123,state:'closed',merged_at:'2026-01-01T00:00:00Z',html_url:'https://evil.test',title:'KEY'});};
 assert.deepEqual(await a.readPRs(ledger,{fetcher,key:'KEY'}),[{url,status:'MERGED',classification:'POTENTIAL_ONLY'}]);assert.deepEqual(calls,['https://api.github.com/repos/owner/repo/pulls/123']);
 for(const ledger of [{approvedPRs:[{url,approved:false}]},{approvedPRs:[{url:url+'?x=1',approved:true}]},{approvedPRs:[{url:'https://evil.test/a/b/pull/1',approved:true}]},{approvedPRs:[],privateKey:'oops'}])await assert.rejects(a.readPRs(ledger,{fetcher}),/Invalid ledger/);
 assert.equal((await a.readPRs({approvedPRs:[{url,approved:true}]},{fetcher:async()=>response({message:'KEY'})}))[0].status,'UNKNOWN');
});
test('configuration accepts only validated public wallet fields', () => {
 assert.equal(typeof a.validateConfig, 'function');
 assert.deepEqual(a.validateConfig(config), config);
 for (const bad of [{...config,url:'https://evil.test'}, {...config,baseWallet:'0x123'}, {...config,solanaWallet:'0'.repeat(32)}, {...config,solanaWallet:'1'.repeat(33)}, null, []]) assert.throws(()=>a.validateConfig(bad), /Invalid configuration/);
 assert.equal(a.validateConfig({...config,baseWallet:'0x'+'a'.repeat(40),solanaWallet:'11111111111111111111111111111111'}).solanaWallet.length,32);
});
