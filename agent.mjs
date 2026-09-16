import {readFile,writeFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export async function watch(config,ledger,{env=process.env,...options}={}) {
 validateConfig(config);validateLedger(ledger);
 const network={...options,key:env.SUPERTEAM_API_KEY||''};
 const [base,solana,listings,prs]=await Promise.all([readBase(config.baseWallet,network),readSolana(config.solanaWallet,network),readListings(network),readPRs(ledger,network)]);
 return {generatedAt:new Date().toISOString(),runtimeSource:env.GITHUB_ACTIONS==='true'?'GITHUB_ACTIONS':'LOCAL',balances:{base,solana},listings,prs,earnings:{status:'NOT_VERIFIED',note:'Balances and baseline are not income. No human-attested payout receipt with transaction and task attribution has been verified.'}};
}
export function renderStatus(s){
 const balance=x=>x.status==='OK'?`${x.balanceUSDC} USDC (balance, not income)`:x.status;
 return `# Read-only earning watcher\n\nGenerated: ${s.generatedAt}\nRuntime source: ${s.runtimeSource}\n\n## Balances\n- Base: ${balance(s.balances.base)}\n- Solana: ${balance(s.balances.solana)}\n\nBalances and baseline are not income. Verified earnings: NOT_VERIFIED.\nA human-attested payout receipt must attribute a transaction to a task.\n\n## Listings\n${s.listings.status} — ${s.listings.scope}; not all listings.\nListing pots are not guaranteed individual payouts. All entries are potential only.\n${s.listings.items.map(x=>`- ${x.title} — ${x.url} — ${x.classification} — listed pot ${x.potentialPotAmount} ${x.token} (not promised pay) — deadline ${x.deadline}`).join('\n')}\n\n## Explicitly approved PRs\n${s.prs.length?s.prs.map(x=>`- ${x.url} — ${x.status} — ${x.classification}`).join('\n'):'None approved.'}\n\nA merged PR does not establish payment. No transactions, signatures, submissions, or registrations are performed.\n`;
}
export async function main(){
 const read=async name=>{const url=new URL(name,import.meta.url);if((await stat(url)).size>65536)throw Error();return JSON.parse(await readFile(url,'utf8'));};
 const status=await watch(await read('config.json'),await read('ledger.json'));
 const redact=s=>process.env.SUPERTEAM_API_KEY?s.split(process.env.SUPERTEAM_API_KEY).join('REDACTED'):s;
 await writeFile(new URL('status.json',import.meta.url),redact(JSON.stringify(status,null,2)+'\n'),'utf8');
 await writeFile(new URL('status.md',import.meta.url),redact(renderStatus(status)),'utf8');
 console.log('Status written. Read-only run complete.');
}

const destinations = Object.freeze({base:'https://mainnet.base.org',solana:'https://api.mainnet-beta.solana.com',listings:'https://superteam.fun/api/agents/listings/live?take=50'});
export async function requestJSON(target, payload, {fetcher=globalThis.fetch,timeoutMs=10000,key=''}={}) {
 let timer; const controller=new AbortController();
 try {
  const github=/^github:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_-][A-Za-z0-9_.-]{0,99})\/([1-9][0-9]{0,9})$/.exec(target);
  if(!Object.hasOwn(destinations,target)&&!github) throw Error();
  const destination=github?`https://api.github.com/repos/${github[1]}/${github[2]}/pulls/${github[3]}`:destinations[target];
  const operation=async()=>{
   const rpc=target==='base'||target==='solana';
   if(rpc && (!object(payload)||payload.method!==(target==='base'?'eth_call':'getTokenAccountsByOwner')))throw Error();
   const headers={Accept:'application/json'};
   if(rpc) headers['Content-Type']='application/json';
   if(target==='listings'&&key) headers.Authorization=`Bearer ${key}`;
   const res=await fetcher(destination,{method:rpc?'POST':'GET',headers,...(rpc?{body:JSON.stringify(payload)}:{}),redirect:'error',signal:controller.signal});
   if(!res.ok || !res.body || Number(res.headers.get('content-length'))>1048576) throw Error();
   const reader=res.body.getReader();const chunks=[];let size=0;
   try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw Error();chunks.push(value);} } finally {await reader.cancel().catch(()=>{});}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},Math.min(10000,Math.max(1,timeoutMs)));})]);
 } catch {controller.abort();throw Error('Request unavailable');} finally {clearTimeout(timer);}
}
function usdc(n){return `${n/1000000n}.${(n%1000000n).toString().padStart(6,'0')}`;}
function rpcResult(x){if(!object(x)||x.jsonrpc!=='2.0'||x.id!==1||Object.hasOwn(x,'error')||!Object.hasOwn(x,'result'))throw Error();return x.result;}
export async function readBase(wallet,options={}) {
 if(wallet==='')return {status:'NOT_CONFIGURED'};
 try {
  validateConfig({baseWallet:wallet,solanaWallet:''});
  const result=rpcResult(await requestJSON('base',{jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',data:'0x70a08231'+'0'.repeat(24)+wallet.slice(2)},'latest']},options));
  if(typeof result!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(result))throw Error();
  return {status:'OK',balanceUSDC:usdc(BigInt(result)),meaning:'BALANCE_NOT_EARNINGS'};
 }catch{return {status:'UNKNOWN'};}
}
const mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export async function readSolana(wallet,options={}) {
 if(wallet==='')return {status:'NOT_CONFIGURED'};
 try {
  validateConfig({baseWallet:'',solanaWallet:wallet});
  const result=rpcResult(await requestJSON('solana',{jsonrpc:'2.0',id:1,method:'getTokenAccountsByOwner',params:[wallet,{mint},{encoding:'jsonParsed',commitment:'finalized'}]},options));
  if(!object(result)||!Number.isSafeInteger(result.context?.slot)||result.context.slot<0||!Array.isArray(result.value))throw Error();
  let total=0n;const seen=new Set();
  for(const entry of result.value){
   const data=entry?.account?.data;const info=data?.parsed?.info;const token=info?.tokenAmount;
   if(!solanaAddress(entry?.pubkey)||seen.has(entry.pubkey)||data?.program!=='spl-token'||data?.parsed?.type!=='account'||info?.owner!==wallet||info?.mint!==mint||token?.decimals!==6||typeof token?.amount!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(token.amount)||BigInt(token.amount)>18446744073709551615n)throw Error();
   seen.add(entry.pubkey);total+=BigInt(token.amount);
  }
  return {status:'OK',balanceUSDC:usdc(total),meaning:'BALANCE_NOT_EARNINGS'};
 }catch{return {status:'UNKNOWN'};}
}
function safeText(s,key='') {
 const redact=x=>key?x.split(key).join('REDACTED'):x;
 return redact(redact(s).replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/[<>\[\](){}*_`#!|\\&]/g,' ').replace(/\s+/g,' ').trim().slice(0,240));
}
export async function readListings(options={}) {
 const base={scope:'LIMITED_SLICE_MAX_50',items:[]};
 if(!options.key)return {status:'PENDING_REGISTRATION',...base};
 let data;try{data=await requestJSON('listings',null,options);}catch{return {status:'UNKNOWN',...base};}
 try{
  if(!Array.isArray(data)||data.length>50)throw Error();
  const items=[];const seen=new Set();
  for(const row of data){
   if(!object(row)||typeof row.title!=='string'||row.title.length>2000||typeof row.slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)||row.slug.length>160||row.slug.includes(options.key)||!['AGENT_ALLOWED','AGENT_ONLY'].includes(row.agentAccess)||typeof row.status!=='string'||typeof row.deadline!=='string'||!Number.isFinite(Date.parse(row.deadline))||!['bounty','hackathon','project'].includes(row.type)||typeof row.token!=='string'||!/^[A-Za-z0-9]{1,16}$/.test(row.token)||row.token.includes(options.key)||!Number.isFinite(row.rewardAmount)||row.rewardAmount<0||seen.has(row.slug))throw Error();
   seen.add(row.slug);
   if(row.status!=='OPEN'||Date.parse(row.deadline)<=Date.now())continue;
   items.push({title:safeText(row.title,options.key),url:`https://superteam.fun/earn/listing/${row.slug}/`,agentAccess:row.agentAccess,deadline:new Date(row.deadline).toISOString(),potentialPotAmount:row.rewardAmount,token:row.token,classification:'POTENTIAL_ONLY'});
  }
  return {status:'OK',scope:base.scope,items};
 }catch{return {status:'UNKNOWN_SCHEMA',...base};}
}
const prPattern=/^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_-][A-Za-z0-9_.-]{0,99})\/pull\/([1-9][0-9]{0,9})$/;
export function validateLedger(x){
 if(!exact(x,['approvedPRs'])||!Array.isArray(x.approvedPRs)||x.approvedPRs.length>50)throw Error('Invalid ledger');
 const seen=new Set();
 for(const row of x.approvedPRs){if(!exact(row,['url','approved'])||row.approved!==true||typeof row.url!=='string'||!prPattern.test(row.url)||seen.has(row.url))throw Error('Invalid ledger');seen.add(row.url);}
 return x;
}
export async function readPRs(ledger,options={}) {
 validateLedger(ledger);const items=[];
 for(const {url} of ledger.approvedPRs){
  const [,owner,repo,number]=prPattern.exec(url);let status='UNKNOWN';
  try{
   const data=await requestJSON(`github:${owner}/${repo}/${number}`,null,options);
   if(!object(data)||data.number!==Number(number)||!['open','closed'].includes(data.state)||!(data.merged_at===null||(typeof data.merged_at==='string'&&Number.isFinite(Date.parse(data.merged_at))))||(data.state==='open'&&data.merged_at!==null))throw Error();
   status=data.merged_at!==null?'MERGED':data.state.toUpperCase();
  }catch{}
  items.push({url,status,classification:'POTENTIAL_ONLY'});
 }
 return items;
}
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length && keys.every(k=>Object.hasOwn(x,k));
function solanaAddress(s) {
 if(typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 let n=0n; for(const c of s) n=n*58n+BigInt(alphabet.indexOf(c));
 let bytes=0; while(n>0n){bytes++;n>>=8n;}
 return bytes + (s.match(/^1*/)[0].length) === 32;
}
export function validateConfig(x) {
 if(!exact(x,['baseWallet','solanaWallet']) || typeof x.baseWallet!=='string' || typeof x.solanaWallet!=='string' || (x.baseWallet!==''&&!/^0x[0-9a-fA-F]{40}$/.test(x.baseWallet)) || (x.solanaWallet!==''&&!solanaAddress(x.solanaWallet))) throw new Error('Invalid configuration');
 return {...x};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(()=>{console.error('Watcher failed: invalid local input or unavailable output.');process.exitCode=1;});
}
