import { createBrowserRouter } from "react-router";
import RegisterPage from "./features/register/RegisterPage.tsx";
import ProfilePage from "./features/profile/ProfilePage.tsx";

export const router = createBrowserRouter([
  { path: "/", element: <RegisterPage /> },
  { path: "/users/:id", element: <ProfilePage /> },
]);
