import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const existingAdmin = await prisma.user.findUnique({
    where: { email: "admin@crm.com" },
  });

  if (existingAdmin) {
    console.log("Admin user already exists");
    return;
  }

  const hashedPassword = await bcrypt.hash("admin123", 12);

  const admin = await prisma.user.create({
    data: {
      name: "Admin",
      email: "admin@crm.com",
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  console.log("Admin user created:", admin.email);

  const demoVendor = await prisma.vendor.create({
    data: {
      name: "DesignStudio Pro",
      slug: "designstudio-pro",
      description: "Professional design and marketing services",
      contactName: "Rajesh Kumar",
      contactEmail: "rajesh@designstudio.com",
      contactPhone: "+91 98765 43210",
    },
  });

  const webDesign = await prisma.service.create({
    data: {
      vendorId: demoVendor.id,
      name: "Web Design",
      description: "Complete website design and development",
      category: "Web",
    },
  });

  await prisma.priceHistory.create({
    data: {
      serviceId: webDesign.id,
      price: 50000,
      currency: "INR",
      effectiveFrom: new Date("2026-01-01"),
    },
  });

  const seo = await prisma.service.create({
    data: {
      vendorId: demoVendor.id,
      name: "SEO Optimization",
      description: "Search engine optimization package",
      category: "Marketing",
    },
  });

  await prisma.priceHistory.create({
    data: {
      serviceId: seo.id,
      price: 15000,
      currency: "INR",
      effectiveFrom: new Date("2026-01-01"),
    },
  });

  const socialMedia = await prisma.service.create({
    data: {
      vendorId: demoVendor.id,
      name: "Social Media Management",
      description: "Monthly social media content and management",
      category: "Marketing",
    },
  });

  await prisma.priceHistory.create({
    data: {
      serviceId: socialMedia.id,
      price: 25000,
      currency: "INR",
      effectiveFrom: new Date("2026-01-01"),
    },
  });

  const demoBrand = await prisma.brand.create({
    data: {
      name: "GameX Studios",
      slug: "gamex-studios",
      description: "Mobile gaming platform for casual gamers",
      contactName: "Amit Sharma",
      contactEmail: "amit@gamex.in",
      contactPhone: "+91 87654 32109",
    },
  });

  const project = await prisma.project.create({
    data: {
      name: "GameX Marketing Campaign",
      slug: "gamex-marketing-2026",
      brandId: demoBrand.id,
      description: "Full marketing campaign for GameX Q3 launch",
      status: "ACTIVE",
      startDate: new Date("2026-06-01"),
    },
  });

  console.log("Demo data created successfully");
  console.log("Login with: admin@crm.com / admin123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
