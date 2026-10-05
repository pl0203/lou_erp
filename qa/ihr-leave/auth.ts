export const manager = new URLSearchParams(window.location.search).get('role') !== 'employee';
const id='71000000-0000-0000-0000-000000000003';
export const useAuth=()=>({user:{id},profile:{id,role:manager?'sales_manager':'sales_person',full_name:'Fictional Manager',is_active:true},loading:false,signOut:async()=>{}});
