// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,it} from 'vitest'
import * as guard from '../employee-browser/guards.mjs'
const a='a'.repeat(40),b='b'.repeat(40),tree='c'.repeat(40)
function fakeGit(){
 const calls:string[][]=[],state={head:a,dirty:false,moveOnTree:false}
 const git=(args:string[])=>{calls.push(args);if(args[0]==='status')return state.dirty?' M src/App.tsx':'';if(args[1]==='HEAD')return state.head;if(args[1]===`${a}^{tree}`){if(state.moveOnTree)state.head=b;return tree};throw Error('Unexpected moving lookup: '+args.join(' '))}
 return {calls,state,git}
}
it('pins the tree to one captured commit and refuses initial dirty source',()=>{
 const capture=(guard as any).captureGitRevision;expect(capture).toBeTypeOf('function')
 const f=fakeGit();expect(capture(f.git)).toEqual({commit:a,tree});expect(f.calls).toContainEqual(['rev-parse',`${a}^{tree}`]);expect(f.calls).not.toContainEqual(['rev-parse','HEAD^{tree}'])
 f.state.dirty=true;expect(()=>capture(f.git)).toThrow(/clean/i)
})
it('rejects commit movement during capture and HEAD or tracked changes before completion',()=>{
 const capture=(guard as any).captureGitRevision,verify=(guard as any).assertGitRevision;expect(capture).toBeTypeOf('function');expect(verify).toBeTypeOf('function')
 const moving=fakeGit();moving.state.moveOnTree=true;expect(()=>capture(moving.git)).toThrow(/changed/i)
 for(const kind of ['head','dirty']){const f=fakeGit(),revision=capture(f.git);if(kind==='head')f.state.head=b;else f.state.dirty=true;expect(()=>verify(f.git,revision)).toThrow(/changed|clean/i)}
 const stable=fakeGit();expect(()=>verify(stable.git,capture(stable.git))).not.toThrow()
})
it('both fixed production captures pin blob lookups and verify before successful labels',()=>{
 const prepare=readFileSync('tests/employee-browser/prepare.mjs','utf8'),source=readFileSync('tests/employee-ci/source.mjs','utf8')
 for(const text of [prepare,source]){expect(text).toContain('captureGitRevision(git)');expect(text).toContain('assertGitRevision(git,');expect(text).not.toContain('`HEAD:${path}`');expect(text).not.toContain("'HEAD^{tree}'")}
 expect(prepare).toContain('`${report.commit}:${path}`');expect(source).toContain('`${commit}:${path}`')
 expect(prepare.lastIndexOf('assertGitRevision(git,')).toBeLessThan(prepare.indexOf("report.status='prepared'"));expect(source.lastIndexOf('assertGitRevision(git,')).toBeLessThan(source.indexOf('return {commit,tree,source}'))
 expect(prepare).toContain("'tests/employees/source-revision.test.ts'")
 expect(JSON.parse(readFileSync('tests/employee-ci/source-files.json','utf8'))).toContain('tests/employees/source-revision.test.ts')
})
