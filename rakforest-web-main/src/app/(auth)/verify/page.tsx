import Link from "next/link";
export default function VerifyAccountPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F2F4F1] p-4">
      <section className="w-full max-w-lg space-y-4 rounded-xl border border-[#D4DCD5] bg-white p-6 text-[#14241B]">
        <h1 className="text-2xl font-bold">รอผู้ดูแลตรวจและอนุมัติบัญชี</h1>
        <p>
          การยืนยันบัญชีใช้การตรวจข้อมูลโดยผู้ดูแล ไม่ต้องกรอกรหัส OTP
          เมื่อได้รับอนุมัติแล้วสามารถเข้าสู่ระบบได้
        </p>
        <p className="text-sm text-[#526358]">
          หากเคยลงทะเบียนไว้แล้ว กรุณาติดต่อผู้ดูแลพร้อมรหัสเจ้าหน้าที่
          เพื่อดำเนินการต่อจากบัญชีเดิม
        </p>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center rounded-lg bg-[#1B4332] px-4 py-2 font-semibold text-white"
        >
          กลับเข้าสู่ระบบ
        </Link>
      </section>
    </main>
  );
}
