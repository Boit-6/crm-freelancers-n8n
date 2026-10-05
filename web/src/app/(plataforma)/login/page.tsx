import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-md px-6 pt-10 pb-20 sm:px-10">
      <div className="border-rule mb-10 border-b pb-8">
        <p className="text-ochre mb-4 text-[10px] tracking-[0.22em] uppercase">Panel interno</p>
        <h1 className="text-ink font-serif text-[clamp(2.4rem,6vw,3rem)] leading-none tracking-tight">
          Iniciar sesión.
        </h1>
      </div>

      <LoginForm />
    </main>
  );
}
