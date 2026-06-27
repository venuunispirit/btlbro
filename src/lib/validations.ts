import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const createBrandSchema = z.object({
  name: z.string().min(1, "Brand name is required"),
  slug: z.string().optional(),
  logo: z.string().optional(),
  description: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  website: z.string().optional(),
});

export const updateBrandSchema = createBrandSchema.partial();

export const createVendorSchema = z.object({
  name: z.string().min(1, "Vendor name is required"),
  slug: z.string().optional(),
  logo: z.string().optional(),
  description: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  website: z.string().optional(),
});

export const updateVendorSchema = createVendorSchema.partial();

export const createServiceSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  name: z.string().min(1, "Service name is required"),
  description: z.string().optional(),
  category: z.string().optional(),
});

export const updateServiceSchema = createServiceSchema.partial();

export const createPriceHistorySchema = z.object({
  serviceId: z.string().min(1),
  price: z.number().min(0, "Price must be positive"),
  currency: z.string().default("INR"),
  effectiveFrom: z.string().datetime().or(z.date()),
  effectiveTo: z.string().datetime().or(z.date()).optional(),
});

export const createQuotationSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  brandId: z.string().min(1, "Brand is required"),
  title: z.string().min(1, "Title is required"),
  validUntil: z.string().datetime().or(z.date()).optional(),
  taxRate: z.number().min(0).max(100).default(18),
  currency: z.string().default("INR"),
  terms: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      serviceId: z.string().optional(),
      vendorId: z.string().optional(),
      description: z.string().min(1, "Description is required"),
      quantity: z.number().min(0.01).default(1),
      unitPrice: z.number().min(0),
    })
  ).min(1, "At least one item is required"),
});

export const updateQuotationSchema = createQuotationSchema.partial().extend({
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]).optional(),
});

export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  slug: z.string().optional(),
  brandId: z.string().min(1, "Brand is required"),
  description: z.string().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "ON_HOLD"]).default("ACTIVE"),
  startDate: z.string().datetime().or(z.date()).optional(),
  endDate: z.string().datetime().or(z.date()).optional(),
});

export const createPresentationSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
});

export const createSlideSchema = z.object({
  presentationId: z.string().min(1),
  order: z.number().min(0),
  transition: z.enum(["FADE", "SLIDE", "ZOOM", "NONE"]).default("FADE"),
  background: z.string().default("#ffffff"),
});

export const createSlideElementSchema = z.object({
  slideId: z.string().min(1),
  type: z.enum(["TEXT", "IMAGE", "SHAPE"]),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(100),
  height: z.number().default(50),
  zIndex: z.number().default(0),
  content: z.any().default({}),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreatePresentationInput = z.infer<typeof createPresentationSchema>;
