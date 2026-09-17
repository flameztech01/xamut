// components/PrivateRoute.jsx
import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Navigate, Outlet, useLocation } from "react-router";
import { logout } from "../features/auth/authSlice";

const isTokenExpired = (token) => {
  if (!token || typeof token !== "string") return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded));

    if (!payload?.exp) return false;
    const expiresAt = payload.exp * 1000;
    const now = Date.now();
    return expiresAt - now < 5000;
  } catch {
    return false;
  }
};

const PrivateRoute = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { userInfo } = useSelector((state) => state.auth);

  const token =
    userInfo?.token || userInfo?.accessToken || userInfo?.jwt || null;

  const hasUser = Boolean(userInfo);
  const expired = hasUser && token ? isTokenExpired(token) : false;

  useEffect(() => {
    if (expired) dispatch(logout());
  }, [expired, dispatch]);

  if (!hasUser || !token || expired) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  return <Outlet />;
};

export default PrivateRoute;