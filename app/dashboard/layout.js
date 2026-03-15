export const metadata = {
  title: 'GudMuzik Dashboard',
  description: 'Smart Links Dashboard — analytics and link management',
};

export default function DashboardLayout({ children }) {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  );
}
