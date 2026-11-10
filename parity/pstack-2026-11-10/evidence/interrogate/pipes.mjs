import { linuxReadonlyCommand } from './linux-readonly-sandbox.ts';
import { spawnSync } from 'node:child_process';
const inner = `node -e "const r=require('node:child_process').spawnSync('echo',['CHILD-PIPE-OK'],{encoding:'utf8'});console.log(r.stdout.trim(),process.stdout.constructor.name);const s=require('node:net').createServer().listen(0,'127.0.0.1',()=>{require('node:net').connect(s.address().port,'127.0.0.1').on('connect',()=>{console.log('TCP-LOOPBACK-OK');process.exit(0)})})"`;
const r = spawnSync('/bin/sh', ['-c', linuxReadonlyCommand(inner, '/tmp')], { encoding: 'utf8' });
console.log('status', r.status, r.stdout, r.stderr);
