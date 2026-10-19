const frame=document.querySelector('#preview'),stage=document.querySelector('#stage'),select=document.querySelector('#qa-viewport'),output=document.querySelector('#qa-geometry')
function resize(){const width=Number(select.value),height=900,scale=Math.min(1,(innerWidth-24)/width);frame.style.width=width+'px';frame.style.height=height+'px';frame.style.transform=`scale(${scale})`;stage.style.width=width*scale+'px';stage.style.height=height*scale+'px';requestAnimationFrame(()=>{const win=frame.contentWindow;output.textContent=`Actual iframe CSS viewport: ${win.innerWidth} × ${win.innerHeight}. Screenshot display scale: ${scale.toFixed(3)}. Reduced motion: ${win.matchMedia('(prefers-reduced-motion: reduce)').matches}.`})}
select.addEventListener('change',resize);window.addEventListener('resize',resize);frame.addEventListener('load',resize)
document.querySelector('#qa-reload').addEventListener('click',()=>frame.contentWindow.location.reload())
setInterval(resize,1000);resize()

// Fixture-only viewport routing, not product navigation or draft continuity proof.
document.querySelector('#qa-directory').addEventListener('click',()=>{frame.src='/ihr/employees'})
document.querySelector('#qa-create').addEventListener('click',()=>{frame.src='/ihr/employees/new'})
document.querySelector('#qa-detail').addEventListener('click',()=>{frame.src='/ihr/employees/97000000-0000-0000-0000-000000000001'})
