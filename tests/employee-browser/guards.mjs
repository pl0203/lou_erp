import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
export const SOURCE_FILES=Object.freeze([
  "package-lock.json",
  "package.json",
  "public/brand/padiwan-logo.svg",
  "public/brand/padiwan-mark.svg",
  "public/fonts/plus-jakarta-sans/OFL.txt",
  "public/fonts/plus-jakarta-sans/PlusJakartaSans-Italic-Variable.ttf",
  "public/fonts/plus-jakarta-sans/PlusJakartaSans-Variable.ttf",
  "public/fonts/plus-jakarta-sans/README.md",
  "src/App.tsx",
  "src/components/AppNavigation.tsx",
  "src/components/BrandLogo.tsx",
  "src/components/IHRNav.tsx",
  "src/components/NavigationIcon.tsx",
  "src/components/navigation.css",
  "src/components/navigationModules.ts",
  "src/components/ui/ActionLink.tsx",
  "src/components/ui/Button.tsx",
  "src/components/ui/Dialog.tsx",
  "src/components/ui/Feedback.tsx",
  "src/components/ui/Field.tsx",
  "src/components/ui/FormActions.tsx",
  "src/components/ui/LoadingState.tsx",
  "src/components/ui/MainContent.tsx",
  "src/components/ui/PageHeader.tsx",
  "src/index.css",
  "src/lib/employees/contracts.ts",
  "src/lib/employees/queryKeys.ts",
  "src/lib/employees/rpc.ts",
  "src/lib/employees/useEmployeeCommand.ts",
  "src/lib/employees/useEmployeeContext.ts",
  "src/lib/employees/useEmployeeNavigationGuard.ts",
  "src/lib/employees/useEmployeeReads.ts",
  "src/lib/useUnsavedChanges.tsx",
  "src/pages/ihr/employees/EmployeeAccountLink.tsx",
  "src/pages/ihr/employees/EmployeeAuditTimeline.tsx",
  "src/pages/ihr/employees/EmployeeDetail.tsx",
  "src/pages/ihr/employees/EmployeeEditor.tsx",
  "src/pages/ihr/employees/EmployeeList.tsx",
  "src/pages/ihr/employees/EmployeeReportingEditor.tsx",
  "src/pages/ihr/employees/EmployeeUI.tsx",
  "src/pages/ihr/employees/employee.css",
  "src/styles/ui.css"
])
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export const blob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
export function assertBrowserManifest(manifest,bytes){
 assert.deepEqual(Object.keys(manifest).sort(),['dependency','files','repository','version'])
 assert.equal(manifest.version,1);assert.equal(manifest.repository,'pl0203/lou_erp');assert.equal(manifest.dependency,'0aacac6cb03027f9e24281eefcc233537d636099')
 assert.deepEqual(manifest.files.map(f=>f.path),SOURCE_FILES)
 assert.equal(bytes.size,SOURCE_FILES.length)
 for(const file of manifest.files){assert.deepEqual(Object.keys(file).sort(),['bytes','path','sha','sha256']);const input=bytes.get(file.path);assert.ok(Buffer.isBuffer(input));assert.equal(input.length,file.bytes);assert.equal(sha(input),file.sha256);assert.equal(blob(input),file.sha)}
}
export function validateBrowserMode(args,env){
 if(args.length===1&&args[0]==='--prepare'){assert.ok(!env.GITHUB_ACTIONS&&!env.GITHUB_RUN_ID&&!env.GITHUB_RUN_ATTEMPT,'Local preparation must not impersonate CI');return 'local-prepare'}
 assert.deepEqual(args,[]);assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_REPOSITORY,'pl0203/lou_erp');assert.equal(env.GITHUB_WORKFLOW,'Pilot safety checks');assert.equal(env.GITHUB_JOB,'synthetic-safety');assert.ok(['pull_request','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME));assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);assert.match(env.GITHUB_RUN_ATTEMPT??'',/^[1-9][0-9]*$/);assert.match(env.EMPLOYEE_BROWSER_SOURCE_SHA??'',/^[a-f0-9]{40}$/);return 'github-ci'
}
export function allowBrowserRequest(url,origin){try{return new URL(url).origin===origin&&/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(origin)}catch{return false}}

// The isolated Vite root must include utilities used by the copied real components.
export function assertBuiltStyles(css){
 for(const selector of ['.sr-only{','.h-8{','.w-8{','.min-h-screen{'])assert.ok(css.includes(selector),`Missing actual source utility ${selector}`)
}

// Pure identity checks shared by the fixed browser/source captures. No CLI/root inputs.
export function assertGitRevision(git,revision){
 assert.equal(git(['status','--porcelain','--untracked-files=no']),'','Tracked source must remain clean')
 assert.equal(git(['rev-parse','HEAD']),revision.commit,'Source HEAD changed during capture')
}
export function captureGitRevision(git){
 assert.equal(git(['status','--porcelain','--untracked-files=no']),'','Tracked source must be clean')
 const commit=git(['rev-parse','HEAD']);assert.match(commit,/^[a-f0-9]{40}$/)
 const tree=git(['rev-parse',`${commit}^{tree}`]);assert.match(tree,/^[a-f0-9]{40}$/)
 const revision={commit,tree};assertGitRevision(git,revision);return revision
}
