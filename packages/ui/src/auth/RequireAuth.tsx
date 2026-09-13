import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useToken } from './token';

export const LOGIN_ROUTE = '/app/login';

export function RequireAuth() {
  const token = useToken();
  const location = useLocation();
  if (!token) {
    return <Navigate to={LOGIN_ROUTE} replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}
