export async function bubbleLogin(email: string, password: string) {
  try {
    const response = await fetch(
      "https://timedealing.com/version-test/api/1.1/wf/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }
    );

    const data = await response.json();
    console.log("🔐 로그인 응답:", data);

    if (data?.status === "success") {
      return {
        user_id: data.response.user_id,
        token: data.response.token,
      };
    } else {
      throw new Error("로그인 실패");
    }
  } catch (error) {
    console.error("❌ 로그인 오류:", error);
    return null;
  }
}