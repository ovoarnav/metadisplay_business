import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Controller, Store, CALENDLY } from '../src/core.ts';
import type { Draft, Session } from '../src/core.ts';
import { makeServer } from '../src/server.ts';

async function fixture(enabled=true, fail=false) {
  const prefix=join(tmpdir(),'followup-legacy-');const dir=mkdtempSync(prefix);const store=new Store(join(dir,'test.sqlite'),randomBytes(32));
  const token=randomBytes(32).toString('hex'),owner=createHash('sha256').update(token).digest('hex');
  let finish!: (d:Draft)=>void;let drafts=0,sends=0;
  const gate=new Promise<Draft>(r=>{finish=r;});
  const controller=new Controller(store,{cue:'cue',live:false,hardwareVerified:false,allowlist:[],oneTap:true,legacyReviewFollowup:enabled},
    {send:async()=>{sends++;return {status:'SENT',detail:'Fake acceptance'};}},Date.now,
    {draft:async()=>{drafts++;return fail?Promise.reject(new Error('fake AI failure')):gate;}});
  const server=makeServer(controller,token);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const request=async(path:string,method='GET',body?:unknown)=>{
    const response=await fetch(url+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,value:await response.json() as {session:Session;pages:string[];legacyReviewFollowup?:boolean;error?:string}};
  };
  const prepare=async()=>{
    const created=await request('/sessions','POST',{consent:true,source:'meta-speech'});const s=created.value.session;const path='/sessions/'+s.id;
    await request(path+'/segment','POST',{id:'note',sequence:1,epoch:s.epoch,source:s.source,capturedMs:0,final:true,speaker:'unknown',text:'We discussed missed follow-ups.'});
    await request(path+'/recipient','POST',{recipient:'tester@example.com'});await request(path+'/confirm','POST',{recipient:'tester@example.com'});
    return {id:s.id,path};
  };
  return {controller,request,prepare,url,owner,finish,drafts:()=>drafts,sends:()=>sends,
    done:async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();assert.ok(resolve(dir).startsWith(resolve(prefix)));rmSync(dir,{recursive:true,force:true});}};
}
const draft:Draft={version:2,subject:'A generated follow-up',body:'Thanks for discussing missed follow-ups.\n'+CALENDLY,calendly:CALENDLY,evidenceIds:['note']};

test('legacy Review wire protocol generates once, reports pollable progress and finishes dry-run',async()=>{
  const f=await fixture();try{
    const {id,path}=await f.prepare();
    assert.equal((await fetch(f.url+path+'/review',{method:'POST'})).status,401);
    const accepted=await f.request(path+'/review','POST',{});assert.equal(accepted.status,202);assert.equal(accepted.value.session.phase,'SENDING');
    assert.equal(accepted.value.legacyReviewFollowup,true);assert.equal(f.controller.read(id,f.owner).phase,'GENERATING');
    assert.equal((await f.request(path)).value.session.phase,'SENDING');assert.ok(accepted.value.session.outcome.includes('Gmail has not been contacted'));
    const duplicate=await f.request(path+'/review','POST',{});assert.equal(duplicate.value.session.epoch,accepted.value.session.epoch);assert.equal(f.drafts(),1);
    // A capture callback still queued by the old app cannot change the frozen snapshot.
    await f.request(path+'/segment','POST',{id:'late',sequence:2,epoch:accepted.value.session.epoch,source:'meta-speech',capturedMs:0,final:true,speaker:'unknown',text:'Late callback'});
    assert.equal(f.controller.read(id,f.owner).segments.length,1);
    f.finish(draft);await f.controller.waitForFollowup(id);
    const done=(await f.request(path)).value.session;assert.equal(done.phase,'DRY_RUN');assert.ok(done.outcome.includes(draft.subject));assert.equal(done.approved?.body,draft.body);
    assert.equal((await f.request(path+'/review','POST',{})).value.session.outboxId,done.outboxId);assert.equal(f.drafts(),1);assert.equal(f.sends(),0);
  }finally{await f.done();}
});

test('legacy alias is explicit opt-in and does not change modern Follow-up progress or normal review',async()=>{
  for(const enabled of [false,true]){const f=await fixture(enabled);try{
    const {id,path}=await f.prepare();
    const response=await f.request(path+(enabled?'/followup':'/review'),'POST',{});
    assert.equal(response.value.session.phase,enabled?'GENERATING':'REVIEW');assert.equal(f.controller.read(id,f.owner).legacyReviewFlow,enabled?false:undefined);
    if(enabled){f.finish(draft);await f.controller.waitForFollowup(id);}else assert.equal(f.drafts(),0);
    assert.equal(f.sends(),0);
  }finally{await f.done();}}
});

test('installed-client End cancels pending AI; old Review still requires recipient and finalized notes',async()=>{
  const f=await fixture();try{
    const created=(await f.request('/sessions','POST',{consent:true,source:'meta-speech'})).value.session;
    assert.equal((await f.request('/sessions/'+created.id+'/review','POST',{})).status,409);
    assert.equal(f.drafts(),0);
    const {id,path}=await f.prepare();await f.request(path+'/review','POST',{});
    assert.equal((await f.request(path,'DELETE')).value.session.phase,'ENDED');f.finish(draft);await f.controller.waitForFollowup(id);
    assert.equal(f.controller.read(id,f.owner).phase,'ENDED');assert.equal(f.controller.read(id,f.owner).outboxId,null);assert.equal(f.sends(),0);
  }finally{await f.done();}
});

test('legacy AI failure uses a known terminal phase and creates no outbox',async()=>{
  const f=await fixture(true,true);try{
    const {id,path}=await f.prepare();await f.request(path+'/review','POST',{});await f.controller.waitForFollowup(id);
    const s=(await f.request(path)).value.session;assert.equal(s.phase,'FAILED');assert.ok(s.outcome.includes('No email sent'));assert.equal(s.outboxId,null);assert.equal(f.sends(),0);
    assert.equal((await f.request(path+'/review','POST',{})).status,409);assert.equal(f.drafts(),1);
  }finally{await f.done();}
});
