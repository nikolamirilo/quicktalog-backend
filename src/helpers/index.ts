export async function revalidateData(app_url: string) {
  await fetch(`${app_url}/api/revalidate`);
}
