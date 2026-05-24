import { Outlet, Link, useLocation } from "react-router";
import { getAllRoutes } from "./router-utils";
import { useState } from "react";
import { AuthMenu } from "./features/authentication/menu/AuthMenu";
import { Button } from "./components/ui/button";

export default function AppLayout() {
	const [isOpen, setIsOpen] = useState(false);
	const location = useLocation();

	const isActive = (path: string) => location.pathname === path;

	const toggleMenu = () => setIsOpen(!isOpen);

	const navigationRoutes: { path: string; label: string }[] = getAllRoutes()
		.filter(
			(route) =>
				route.handle?.showInNavigation === true &&
				route.fullPath !== undefined &&
				route.handle?.label !== undefined,
		)
		.map(
			(route) =>
				({
					path: route.fullPath,
					label: route.handle?.label,
				}) as { path: string; label: string },
		);

	return (
		<>
			<nav className="bg-white border-b border-gray-200">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="flex justify-between items-center h-16">
						<Link to="/" className="text-xl font-semibold text-gray-900">
							React App
						</Link>
						<div className="flex items-center gap-2">
							<AuthMenu />
							<Button
								variant="ghost"
								size="icon"
								onClick={toggleMenu}
								aria-label="Toggle menu"
								aria-expanded={isOpen}
							>
								<div className="w-6 h-6 flex flex-col justify-center space-y-1.5">
									<span
										className={`block h-0.5 w-6 bg-current transition-all ${
											isOpen ? "rotate-45 translate-y-2" : ""
										}`}
									/>
									<span
										className={`block h-0.5 w-6 bg-current transition-all ${isOpen ? "opacity-0" : ""}`}
									/>
									<span
										className={`block h-0.5 w-6 bg-current transition-all ${
											isOpen ? "-rotate-45 -translate-y-2" : ""
										}`}
									/>
								</div>
							</Button>
						</div>
					</div>
					{isOpen && (
						<div className="pb-4">
							<div className="flex flex-col space-y-1">
								{navigationRoutes.map((item) => (
									<Button
										key={item.path}
										variant={isActive(item.path) ? "secondary" : "ghost"}
										asChild
										className="justify-start"
									>
										<Link to={item.path} onClick={() => setIsOpen(false)}>
											{item.label}
										</Link>
									</Button>
								))}
							</div>
						</div>
					)}
				</div>
			</nav>
			<Outlet />
		</>
	);
}
