const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const types = require('@babel/types');
const root = path.resolve('apps/desktop/src/renderer/src');
const records = new Set();
function files(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : /\.(tsx|ts)$/.test(e.name) && !e.name.endsWith('.d.ts') && !dir.includes(`${path.sep}i18n`) ? [path.join(dir,e.name)] : []); }
for(const file of files(root)) {
  const source = fs.readFileSync(file,'utf8'); const ast = parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']}); let changed=false;
  const call=(text)=>{records.add(text);changed=true; return types.callExpression(types.identifier('tr'),[types.stringLiteral(text)]);};
  traverse(ast,{
    JSXText(p){ const text=p.node.value.replace(/\s+/g,' ').trim(); if(/[\u3400-\u9fff]/.test(text)) p.replaceWith(types.jsxExpressionContainer(call(text))); },
    StringLiteral(p){ if(!/[\u3400-\u9fff]/.test(p.node.value))return; if(p.parentPath.isCallExpression() && p.parent.callee.type==='Identifier' && p.parent.callee.name==='tr') {records.add(p.node.value);return;} if(p.parentPath.isImportDeclaration() || p.parentPath.isObjectProperty() && p.key==='key' || p.parentPath.isBinaryExpression())return;
      if(p.parentPath.isCallExpression() && p.parent.callee.type==='MemberExpression' && ['includes','startsWith','endsWith','replace','replaceAll','split','match','test'].includes(p.parent.callee.property.name))return;
      const replacement=call(p.node.value); if(p.parentPath.isJSXAttribute())p.replaceWith(types.jsxExpressionContainer(replacement));else p.replaceWith(replacement);p.skip();
    },
    TemplateLiteral(p){if(p.parentPath.isTaggedTemplateExpression()||!p.node.quasis.some(q=>/[\u3400-\u9fff]/.test(q.value.cooked||'')))return;
      const text=p.node.quasis.map((q,i)=>(q.value.cooked||'')+(i<p.node.expressions.length?`{${i}}`:'')).join('');const replacement=call(text);replacement.arguments.push(types.arrayExpression(p.node.expressions));p.replaceWith(replacement);p.skip();}
  });
  if(changed && process.argv.includes('--write')) {
    const relative=path.relative(path.dirname(file),path.join(root,'i18n','index')).replaceAll('\\','/');
    if(!ast.program.body.some(n=>types.isImportDeclaration(n)&&n.specifiers.some(s=>s.local?.name==='tr')))ast.program.body.unshift(types.importDeclaration([types.importSpecifier(types.identifier('tr'),types.identifier('tr'))],types.stringLiteral(relative.startsWith('.')?relative:`./${relative}`)));
    fs.writeFileSync(file,generate(ast,{retainLines:true,jsescOption:{minimal:true}},source).code+'\n');
  }
}
fs.mkdirSync('.tmp-i18n',{recursive:true});fs.writeFileSync('.tmp-i18n/strings.json',JSON.stringify([...records].sort(),null,2)); console.log(JSON.stringify([...records].sort(),null,2));
