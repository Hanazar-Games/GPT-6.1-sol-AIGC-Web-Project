import test from 'node:test';
import assert from 'node:assert/strict';
import {createCarState,stepCar,resolveBarrier,DriftScore} from '../src/physics.js';
const road={distance:0,halfWidth:10};
function simulate(s,input,seconds,dt=1/120){for(let i=0;i<seconds/dt;i++)stepCar(s,input,dt,road);return s;}
test('accelerates, brakes and reverses with finite bounded speed',()=>{const s=simulate(createCarState(),{throttle:true,steer:0},20);assert(s.speed>35&&s.speed<=55);simulate(s,{reverse:true,steer:0},5);assert(s.vz<0&&s.vz>=-9);assert(Number.isFinite(s.x));});
test('handbrake turn produces a scoreable slide',()=>{const s=simulate(createCarState(),{throttle:true,steer:0},3);simulate(s,{throttle:true,steer:1,brake:true},.8);assert(s.slip>.13);assert(s.drifting);});
test('fixed-time simulation remains consistent across step sizes',()=>{const a=simulate(createCarState(),{throttle:true,steer:.4},4,1/120),b=simulate(createCarState(),{throttle:true,steer:.4},4,1/240);assert(Math.hypot(a.x-b.x,a.z-b.z)<.5);});
test('drift chain banks after grace and collision reset loses unbanked points',()=>{const s=new DriftScore();for(let i=0;i<600;i++)s.update({drifting:true,speed:25,slip:.4},1/120);assert(s.multiplier>=2);assert(s.total===0);s.update({drifting:false},2);assert(s.total>0);const saved=s.total;s.update({drifting:true,speed:20,slip:.5},1);s.reset();assert.equal(s.total,saved);assert.equal(s.chain,0);});
test('barrier removes outward velocity and confines car',()=>{const s=createCarState(20,0);s.vx=20;assert(resolveBarrier(s,{x:0,z:0,distance:20},10));assert(s.x<=12.8);assert(s.vx<0);assert(!resolveBarrier(s,{x:0,z:0,distance:20},10));});
