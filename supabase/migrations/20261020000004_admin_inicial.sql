-- =============================================================================
-- Administrador inicial.
-- Cuando esta cuenta se registre y confirme su correo, recibe el rol 'admin'
-- (ver handle_auth_user). La fila se elimina al usarse. No contiene contraseñas.
-- Para otro despliegue, cambia el correo antes de aplicar la migración.
-- =============================================================================
insert into public.bootstrap_admins (email) values ('yulianj.carrasco@gmail.com')
on conflict do nothing;
